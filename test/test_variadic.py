"""
Test per funzioni variadiche in Python ctypes

Verifica il supporto per funzioni C variadiche come printf, sprintf, ecc.
Questo è l'equivalente di test_variadic.js per confrontare il comportamento.
"""

import sys
import platform
from ctypes import (
    CDLL, c_int, c_char_p, c_double, c_size_t,
    create_string_buffer, POINTER, c_char
)

print('=== Test Funzioni Variadiche (Python ctypes) ===\n')

# Carica la libreria C standard
is_windows = platform.system() == 'Windows'

print('Test 1: Caricamento libreria')
try:
    if is_windows:
        # Su Windows usiamo msvcrt.dll per le funzioni C runtime
        libc = CDLL('msvcrt.dll')
        print('  ✓ Caricato msvcrt.dll (Windows)\n')
    else:
        # Su Linux/macOS
        libc_names = ['libc.so.6', 'libc.so', 'libSystem.B.dylib']
        libc = None
        for name in libc_names:
            try:
                libc = CDLL(name)
                print(f'  ✓ Caricato {name}\n')
                break
            except OSError:
                continue
        
        if libc is None:
            raise OSError('Impossibile caricare libc')
except Exception as e:
    print(f'  ✗ Errore: {e}')
    sys.exit(1)

# Test 2: sprintf con stringa semplice
print('Test 2: sprintf con stringa semplice')
try:
    # Definisci sprintf - in Python ctypes le funzioni variadiche non hanno una firma speciale
    sprintf = libc.sprintf
    sprintf.restype = c_int
    
    buffer = create_string_buffer(256)
    format_str = b'Hello, World!'
    
    result = sprintf(buffer, format_str)
    output = buffer.value.decode('utf-8')
    
    print(f'  Input: "Hello, World!"')
    print(f'  Output: {output}')
    print(f'  Lunghezza: {result}')
    
    if output == 'Hello, World!' and result == 13:
        print('  ✓ sprintf funziona correttamente\n')
    else:
        raise ValueError(f'Risultato inatteso: "{output}" (len: {result})')
except Exception as e:
    print(f'  ✗ Errore: {e}\n')

# Test 3: sprintf con un intero
print('Test 3: sprintf con formato %d')
try:
    sprintf = libc.sprintf
    sprintf.restype = c_int
    
    buffer = create_string_buffer(256)
    format_str = b'Number: %d'
    
    result = sprintf(buffer, format_str, 42)
    output = buffer.value.decode('utf-8')
    
    print(f'  Input: "Number: %d", 42')
    print(f'  Output: {output}')
    print(f'  Lunghezza: {result}')
    
    if output == 'Number: 42' and result == 10:
        print('  ✓ sprintf con %d funziona correttamente\n')
    else:
        raise ValueError(f'Risultato inatteso: "{output}" (len: {result})')
except Exception as e:
    print(f'  ✗ Errore: {e}\n')

# Test 4: sprintf con multipli argomenti
print('Test 4: sprintf con multipli argomenti')
try:
    sprintf = libc.sprintf
    sprintf.restype = c_int
    
    buffer = create_string_buffer(256)
    format_str = b'%s: %d + %d = %d'
    label = b'Somma'
    
    result = sprintf(buffer, format_str, label, 10, 20, 30)
    output = buffer.value.decode('utf-8')
    
    print(f'  Input: "%s: %d + %d = %d", "Somma", 10, 20, 30')
    print(f'  Output: {output}')
    print(f'  Lunghezza: {result}')
    
    if output == 'Somma: 10 + 20 = 30':
        print('  ✓ sprintf con multipli argomenti funziona correttamente\n')
    else:
        raise ValueError(f'Risultato inatteso: "{output}"')
except Exception as e:
    print(f'  ✗ Errore: {e}\n')

# Test 5: sprintf con float/double
print('Test 5: sprintf con formato %f')
try:
    sprintf = libc.sprintf
    sprintf.restype = c_int
    
    buffer = create_string_buffer(256)
    format_str = b'Pi: %.2f'
    
    result = sprintf(buffer, format_str, c_double(3.14159))
    output = buffer.value.decode('utf-8')
    
    print(f'  Input: "Pi: %.2f", 3.14159')
    print(f'  Output: {output}')
    print(f'  Lunghezza: {result}')
    
    if output == 'Pi: 3.14':
        print('  ✓ sprintf con %f funziona correttamente\n')
    else:
        raise ValueError(f'Risultato inatteso: "{output}"')
except Exception as e:
    print(f'  ✗ Errore: {e}\n')

# Test 6: sprintf con formato complesso
print('Test 6: sprintf con formato complesso')
try:
    sprintf = libc.sprintf
    sprintf.restype = c_int
    
    buffer = create_string_buffer(256)
    format_str = b'Int: %d, Hex: 0x%x, String: %s, Float: %.2f'
    str_arg = b'test'
    
    result = sprintf(buffer, format_str, 255, 255, str_arg, c_double(2.718))
    output = buffer.value.decode('utf-8')
    
    print(f'  Input: formato misto con int, hex, string, float')
    print(f'  Output: {output}')
    print(f'  Lunghezza: {result}')
    
    if 'Int: 255' in output and '0xff' in output and 'test' in output:
        print('  ✓ sprintf con formato complesso funziona correttamente\n')
    else:
        raise ValueError(f'Risultato inatteso: "{output}"')
except Exception as e:
    print(f'  ✗ Errore: {e}\n')

# Test 7: printf (output su stdout)
print('Test 7: printf output su stdout')
try:
    printf = libc.printf
    printf.restype = c_int
    
    format_str = b'printf test: %s %d\n'
    str_arg = b'Hello'
    
    print(f'  Chiamata: printf("printf test: %s %d\\n", "Hello", 123)')
    print(f'  Output atteso su stdout:')
    result = printf(format_str, str_arg, 123)
    print(f'  Caratteri stampati: {result}')
    print('  ✓ printf eseguito\n')
except Exception as e:
    print(f'  ✗ Errore: {e}\n')

# Test 8: snprintf (versione sicura con limite di buffer)
print('Test 8: snprintf con limite buffer')
try:
    # Su Windows si chiama _snprintf invece di snprintf
    if is_windows:
        snprintf = libc._snprintf
    else:
        snprintf = libc.snprintf
    snprintf.restype = c_int
    
    buffer = create_string_buffer(15)  # Buffer per test
    
    # Inizializza il buffer con zeri per garantire null-termination
    for i in range(15):
        buffer[i] = 0
    
    format_str = b'Very long string %d'
    
    # snprintf con buffer limitato a 10 byte
    result = snprintf(buffer, c_size_t(10), format_str, 123)
    
    # Assicurati che ci sia null-termination
    buffer[9] = 0
    output = buffer.value.decode('utf-8')
    
    print(f'  Input: "Very long string %d", 123 (buffer size: 10)')
    print(f'  Output: {output}')
    print(f'  Caratteri scritti: {result}')
    print(f'  Output length: {len(output)}')
    
    # _snprintf su Windows ha comportamento diverso da snprintf POSIX:
    # - snprintf POSIX: ritorna il numero di caratteri che sarebbero stati scritti
    # - _snprintf Windows: ritorna -1 se il buffer è troppo piccolo
    if is_windows:
        if len(output) < 10:
            print('  ✓ _snprintf rispetta il limite del buffer (Windows)\n')
        else:
            raise ValueError(f'Buffer overflow: "{output}" (len: {len(output)})')
    else:
        if len(output) < 10 and result > len(output):
            print('  ✓ snprintf rispetta il limite del buffer\n')
        else:
            raise ValueError(f'Risultato inatteso: "{output}" (len: {len(output)}, result: {result})')
except Exception as e:
    print(f'  ✗ Errore: {e}\n')

print('=== Test Completati ===')
