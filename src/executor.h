#pragma once

#include <deque>
#include <functional>

#include "function.h"
#include "shared.h"

namespace ctypes {

// Una chiamata accodata su un Executor: proprietà della coda, poi del thread
// nativo, poi del thread JS che la completa (e la distrugge).
struct ExecutorJob {
  uint64_t id = 0;
  FFIFunction::PreparedCall* call = nullptr;
};

// Stato condiviso tra l'Executor (thread JS) e il suo thread nativo. Il thread
// ne tiene un riferimento: se l'environment si chiude durante una chiamata il
// thread viene staccato e può sopravvivere all'oggetto JS.
struct ExecutorQueue {
  std::mutex mutex;
  std::condition_variable wake;
  // Attesa attiva (µs) del thread nativo dopo una chiamata, prima di dormire,
  // e del thread JS per una chiamata inviata a un Executor inattivo; 0 la disattiva.
  std::chrono::microseconds spin{0};
  // Chiamate accodate (incrementato a ogni push): il thread nativo lo osserva durante l'attesa attiva.
  std::atomic<uint64_t> submitted{0};
  // Chiamate eseguite: il thread JS lo osserva mentre attende una chiamata.
  std::atomic<uint64_t> finished{0};
  bool parked = false;        // il thread nativo dorme sulla condition variable
  uint64_t awaited = 0;       // id della chiamata attesa dal thread JS (niente notifica TSFN)
  bool awaited_done = false;  // la chiamata attesa è conclusa ed è in done
  // Una notifica della TSFN è in sospeso: la sua consegna preleverà tutti i
  // completati, quindi le chiamate concluse nel frattempo non ne inviano altre.
  // Azzerato dalla consegna, sotto lo stesso lock con cui preleva done.
  bool notify_pending = false;
  // Thread JS: giri dell'event loop osservati, contati alla consegna di un
  // segnaposto inviato alla TSFN dal thread JS stesso (in attesa: turn_posted).
  uint64_t turns = 0;
  bool turn_posted = false;
  std::deque<ExecutorJob> waiting;  // accodate, non ancora iniziate
  std::vector<ExecutorJob> done;    // eseguite, da completare sul thread JS
  bool busy = false;                // una chiamata in esecuzione
  bool stopping = false;            // il thread esce appena la coda è vuota
  bool abandoned = false;           // environment chiuso: nessuna notifica, nessun completamento
  napi_threadsafe_function channel = nullptr;
  // Completa le chiamate eseguite sul thread JS (vuota dopo la distruzione dell'Executor).
  std::function<void(Napi::Env, std::vector<ExecutorJob>&&)> deliver;
};

// Thread JS: consegna le chiamate eseguite (env nullo quando la TSFN viene
// svuotata alla chiusura dell'environment).
void DeliverExecutorCompletions(Napi::Env env, Napi::Function, ExecutorQueue* queue, void* data);

using ExecutorChannel = Napi::TypedThreadSafeFunction<ExecutorQueue, void, DeliverExecutorCompletions>;

// Durata tipica di una funzione chiamata su un Executor (media mobile delle
// durate misurate da PreparedCall::Run), da cui dipende l'attesa in linea.
struct FunctionTiming {
  std::chrono::nanoseconds expected{0};
  // Attese in linea scadute di fila e attese da saltare: se la chiamata non si
  // conclude in tempo (es. il thread nativo si sveglia lentamente) la funzione
  // smette per un po' di attendere, senza toccare le altre.
  uint32_t misses = 0;
  uint32_t skip = 0;
};

// Un thread nativo posseduto, con una coda FIFO: fn.callOn(executor, ...args)
// esegue la chiamata su questo thread invece che su un worker del pool libuv.
// Le chiamate vengono eseguite una alla volta, in ordine di arrivo; il thread
// parte alla prima chiamata e non tiene vivo il processo quando è inattivo.
class Executor : public Napi::ObjectWrap<Executor> {
 public:
  static constexpr napi_type_tag kTypeTag{0x5b8f0e3c71a24d96ULL, 0xa3c41e7b9d0f2865ULL};

  static Napi::Function GetClass(Napi::Env env);

  explicit Executor(const Napi::CallbackInfo& info);
  ~Executor();

  // Thread JS: accoda una chiamata preparata e restituisce l'id del suo job
  // (per annullarla finché è in coda). Su un Executor chiuso la sua Promise
  // viene rifiutata e l'id è 0.
  uint64_t Submit(Napi::Env env, std::unique_ptr<FFIFunction::PreparedCall> call);

 private:
  Napi::Value Close(const Napi::CallbackInfo& info);
  Napi::Value Cancel(const Napi::CallbackInfo& info);
  Napi::Value GetPending(const Napi::CallbackInfo& info);
  Napi::Value GetCompleted(const Napi::CallbackInfo& info);
  Napi::Value GetRunning(const Napi::CallbackInfo& info);
  Napi::Value GetClosed(const Napi::CallbackInfo& info);
  Napi::Value GetLastJob(const Napi::CallbackInfo& info);
  Napi::Value GetInlineCompleted(const Napi::CallbackInfo& info);
  // _inlineBudget(address): attesa in linea (µs) per la funzione a quell'indirizzo (per i test).
  Napi::Value GetInlineBudget(const Napi::CallbackInfo& info);

  void Start(Napi::Env env);
  // Thread inattivo: lo ferma, attende che esca e rilascia la TSFN.
  void Stop(Napi::Env env);
  // Completa le chiamate eseguite; restituisce il primo errore inatteso.
  std::optional<Napi::Error> Deliver(Napi::Env env, std::vector<ExecutorJob>&& jobs);
  // Thread JS: attende per al più `budget` la chiamata appena inviata a un
  // Executor inattivo (`finished`: il contatore prima dell'invio) e, se
  // conclusa, la completa subito, senza il giro della TSFN.
  void AwaitInline(Napi::Env env, uint64_t finished, std::chrono::nanoseconds budget, const void* function);
  // Se `function` deve saltare questa attesa (dopo attese scadute); consuma un salto.
  bool SkipInline(const void* function);
  // Esito di un'attesa in linea di `function`: azzera o allunga i salti.
  void InlineOutcome(const void* function, bool completed);
  // Attesa in linea per una chiamata a `function`: `spin` per una funzione mai
  // vista, altrimenti una volta e mezza la sua durata tipica (almeno `spin`);
  // zero se supera spin_limit_ (funzione di solito più lenta: niente attesa).
  [[nodiscard]] std::chrono::nanoseconds InlineBudget(const void* function) const;
  // Aggiorna la durata tipica di `function` con una chiamata conclusa.
  void Learn(const void* function, std::chrono::nanoseconds duration);
  // Se il giro corrente dell'event loop può ancora completare chiamate in linea.
  bool InlineSliceLeft();
  // Invia il segnaposto del giro dell'event loop, se non è già in attesa.
  bool PostTurnMarker();
  // Dopo ogni chiamata conclusa: unref quando non ne restano, chiusura se richiesta.
  void Settled(Napi::Env env);
  // Con chiamate in sospeso: processo vivo (TSFN ref) e oggetto JS non raccolto.
  void Hold(Napi::Env env);
  void FinishClose(Napi::Env env);
  static void EnvCleanup(Executor* executor);
  void Abandon();

  std::shared_ptr<ExecutorQueue> queue_ = std::make_shared<ExecutorQueue>();
  std::thread thread_;
  ExecutorChannel channel_;
  std::string name_;
  napi_env env_ = nullptr;
  bool started_ = false;
  bool closed_ = false;
  bool abandoned_ = false;
  bool held_ = false;
  // Durante Deliver: niente attese in linea per le chiamate inviate dagli errcheck.
  bool delivering_ = false;
  // Attesa in linea massima per funzione (opzione spinLimit, almeno spin).
  std::chrono::nanoseconds spin_limit_{0};
  // Durata tipica per funzione chiamata (thread JS).
  std::unordered_map<const void*, FunctionTiming> timings_;
  // Chiamate completate in linea (per i test).
  uint64_t inline_completed_ = 0;
  // Completamenti in linea per giro dell'event loop: dal primo, al più
  // kInlineSlice; poi le chiamate passano dalla TSFN e il loop gira (timer, I/O,
  // UI). Un giro nuovo si riconosce dalla consegna del segnaposto della TSFN,
  // che avviene solo quando il loop torna a elaborarla.
  uint64_t inline_turn_ = UINT64_MAX;
  std::chrono::steady_clock::time_point inline_since_;
  // Errore inatteso di un completamento in linea, sollevato alla consegna del segnaposto.
  std::optional<Napi::Error> deferred_error_;
  // Ferma il thread alla chiusura dell'environment (vuoto se il thread non è avviato).
  Napi::Env::CleanupHook<void (*)(Executor*), Executor> cleanup_hook_;
  // Chiamate accodate o in esecuzione (contate sul thread JS).
  size_t pending_ = 0;
  uint64_t completed_ = 0;
  uint64_t next_job_ = 0;
  uint64_t last_job_ = 0;
  // close(): la stessa Promise per ogni chiamata, risolta quando il thread è fermo.
  std::optional<Napi::Promise::Deferred> closing_;
  Napi::ObjectReference close_promise_;
};

}  // namespace ctypes
