// enex-audio.exe — Ekran paylaşımı için uygulama sesi yakalayıcı.
//
// Windows'un "process loopback" özelliğini kullanır (Windows 10 2004+ / Windows 11):
//   --hwnd <pencere>   : sadece o pencerenin uygulamasının (ve alt süreçlerinin) sesi
//   --exclude <pid>    : bilgisayarın tüm sesi, AMA verilen sürecin (Enex) sesi HARİÇ
// Böylece yayına Discord'daki konuşmalar karışmaz.
//
// Çıktı: stdout'a 48 kHz, 2 kanal, 16 bit PCM. stdin kapanınca (Enex kapanınca) çıkar.

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <initguid.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <io.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// audioclientactivationparams.h (mingw'de yok, elle tanımlıyoruz)
typedef enum { AUDIOCLIENT_ACTIVATION_TYPE_DEFAULT = 0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK = 1 } AUDIOCLIENT_ACTIVATION_TYPE;
typedef enum { PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE = 0, PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE = 1 } PROCESS_LOOPBACK_MODE;
typedef struct { DWORD TargetProcessId; PROCESS_LOOPBACK_MODE ProcessLoopbackMode; } AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS;
typedef struct {
  AUDIOCLIENT_ACTIVATION_TYPE ActivationType;
  union { AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS ProcessLoopbackParams; };
} AUDIOCLIENT_ACTIVATION_PARAMS;
#define VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK L"VAD\\Process_Loopback"

static const IID IID_IAgileObject_ = { 0x94ea2b94, 0xe9cc, 0x49e0, { 0xc0, 0xff, 0xee, 0x64, 0xca, 0x8f, 0x5b, 0x90 } };

static void die(const char *msg, HRESULT hr) {
  fprintf(stderr, "enex-audio: %s (0x%08lx)\n", msg, (unsigned long)hr);
  fflush(stderr);
  ExitProcess(1);
}

// ActivateAudioInterfaceAsync tamamlanınca çağrılan COM nesnesi
class Handler : public IActivateAudioInterfaceCompletionHandler {
  LONG ref = 1;
public:
  HANDLE done = CreateEventW(NULL, TRUE, FALSE, NULL);
  HRESULT result = E_FAIL;
  IAudioClient *client = NULL;

  STDMETHODIMP QueryInterface(REFIID riid, void **ppv) override {
    if (riid == __uuidof(IUnknown) || riid == __uuidof(IActivateAudioInterfaceCompletionHandler) || riid == IID_IAgileObject_) {
      *ppv = static_cast<IActivateAudioInterfaceCompletionHandler *>(this);
      AddRef();
      return S_OK;
    }
    *ppv = NULL;
    return E_NOINTERFACE;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&ref); }
  STDMETHODIMP_(ULONG) Release() override { LONG r = InterlockedDecrement(&ref); if (!r) delete this; return r; }

  STDMETHODIMP ActivateCompleted(IActivateAudioInterfaceAsyncOperation *op) override {
    HRESULT hrAct = E_FAIL;
    IUnknown *unk = NULL;
    HRESULT hr = op->GetActivateResult(&hrAct, &unk);
    if (SUCCEEDED(hr) && SUCCEEDED(hrAct) && unk) {
      result = unk->QueryInterface(__uuidof(IAudioClient), (void **)&client);
      unk->Release();
    } else {
      result = FAILED(hr) ? hr : hrAct;
    }
    SetEvent(done);
    return S_OK;
  }
};

// Enex kapanınca (stdin kapanır) biz de kapanalım
static DWORD WINAPI watchStdin(LPVOID) {
  char buf[64];
  DWORD n;
  HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
  while (ReadFile(in, buf, sizeof buf, &n, NULL) && n > 0) {}
  ExitProcess(0);
  return 0;
}

int main(int argc, char **argv) {
  DWORD pid = 0;
  PROCESS_LOOPBACK_MODE mode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;

  for (int i = 1; i + 1 < argc; i++) {
    if (!strcmp(argv[i], "--hwnd")) {
      HWND hwnd = (HWND)(uintptr_t)_strtoui64(argv[i + 1], NULL, 10);
      GetWindowThreadProcessId(hwnd, &pid);
      mode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
    } else if (!strcmp(argv[i], "--exclude")) {
      pid = (DWORD)strtoul(argv[i + 1], NULL, 10);
      mode = PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;
    }
  }
  if (!pid) die("hedef surec bulunamadi", E_INVALIDARG);

  _setmode(_fileno(stdout), _O_BINARY);
  CreateThread(NULL, 0, watchStdin, NULL, 0, NULL);

  HRESULT hr = CoInitializeEx(NULL, COINIT_MULTITHREADED);
  if (FAILED(hr)) die("CoInitializeEx", hr);

  AUDIOCLIENT_ACTIVATION_PARAMS params = {};
  params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  params.ProcessLoopbackParams.TargetProcessId = pid;
  params.ProcessLoopbackParams.ProcessLoopbackMode = mode;

  PROPVARIANT pv;
  PropVariantInit(&pv);
  pv.vt = VT_BLOB;
  pv.blob.cbSize = sizeof(params);
  pv.blob.pBlobData = (BYTE *)&params;

  Handler *handler = new Handler();
  IActivateAudioInterfaceAsyncOperation *op = NULL;
  hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &pv, handler, &op);
  if (FAILED(hr)) die("ActivateAudioInterfaceAsync", hr);
  WaitForSingleObject(handler->done, INFINITE);
  if (FAILED(handler->result) || !handler->client) die("ses arayuzu acilamadi", handler->result);
  IAudioClient *client = handler->client;

  WAVEFORMATEX fmt = {};
  fmt.wFormatTag = WAVE_FORMAT_PCM;
  fmt.nChannels = 2;
  fmt.nSamplesPerSec = 48000;
  fmt.wBitsPerSample = 16;
  fmt.nBlockAlign = fmt.nChannels * fmt.wBitsPerSample / 8;
  fmt.nAvgBytesPerSec = fmt.nSamplesPerSec * fmt.nBlockAlign;

  hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED,
                          AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
                          200000, 0, &fmt, NULL);
  if (FAILED(hr)) die("Initialize", hr);

  HANDLE ev = CreateEventW(NULL, FALSE, FALSE, NULL);
  hr = client->SetEventHandle(ev);
  if (FAILED(hr)) die("SetEventHandle", hr);

  IAudioCaptureClient *cap = NULL;
  hr = client->GetService(__uuidof(IAudioCaptureClient), (void **)&cap);
  if (FAILED(hr)) die("GetService", hr);

  hr = client->Start();
  if (FAILED(hr)) die("Start", hr);

  HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);
  static BYTE silence[48000 * 4];

  for (;;) {
    WaitForSingleObject(ev, 100);
    UINT32 packet = 0;
    while (SUCCEEDED(cap->GetNextPacketSize(&packet)) && packet > 0) {
      BYTE *data = NULL;
      UINT32 frames = 0;
      DWORD flags = 0;
      hr = cap->GetBuffer(&data, &frames, &flags, NULL, NULL);
      if (FAILED(hr)) break;
      DWORD bytes = frames * fmt.nBlockAlign;
      const BYTE *src = (flags & AUDCLNT_BUFFERFLAGS_SILENT) ? silence : data;
      while (bytes > 0) {
        DWORD chunk = bytes > sizeof silence ? sizeof silence : bytes;
        DWORD written = 0;
        if (!WriteFile(out, src, chunk, &written, NULL)) ExitProcess(0); // Enex kapandı
        bytes -= written;
        if (src != silence) src += written;
      }
      cap->ReleaseBuffer(frames);
    }
  }
  return 0;
}
