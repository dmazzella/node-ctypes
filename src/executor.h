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

  // Thread JS: accoda una chiamata preparata. Su un Executor chiuso la sua
  // Promise viene rifiutata.
  void Submit(Napi::Env env, std::unique_ptr<FFIFunction::PreparedCall> call);

 private:
  Napi::Value Close(const Napi::CallbackInfo& info);
  Napi::Value Cancel(const Napi::CallbackInfo& info);
  Napi::Value GetPending(const Napi::CallbackInfo& info);
  Napi::Value GetCompleted(const Napi::CallbackInfo& info);
  Napi::Value GetRunning(const Napi::CallbackInfo& info);
  Napi::Value GetClosed(const Napi::CallbackInfo& info);
  Napi::Value GetLastJob(const Napi::CallbackInfo& info);

  void Start(Napi::Env env);
  // Thread inattivo: lo ferma, attende che esca e rilascia la TSFN.
  void Stop(Napi::Env env);
  void Deliver(Napi::Env env, std::vector<ExecutorJob>&& jobs);
  // Dopo ogni chiamata conclusa: unref quando non ne restano, chiusura se richiesta.
  void Settled(Napi::Env env);
  // Con chiamate in sospeso: processo vivo (TSFN ref) e oggetto JS non raccolto.
  void Hold(Napi::Env env);
  void FinishClose(Napi::Env env);
  static void EnvCleanup(void* data);
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
