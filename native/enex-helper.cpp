// enex-helper.exe — Oyun algılama ve oyun içi arayüz için küçük yardımcı.
//
// Her satır bir JSON nesnesi olarak stdout'a yazar:
//   {"t":"procs","list":[[pid,"C:\\yol\\oyun.exe"],...]}    her --procs ms'de bir (varsayılan 5000)
//   {"t":"fg","pid":123,"path":"...","cls":"...","full":true,"mon":[x,y,w,h],"win":[x,y,w,h]}
//                                                           ön plandaki pencere değişince
// Koordinatlar fiziksel piksel. stdin kapanınca (Enex kapanınca) çıkar.
// Hiçbir sürece yazmaz, enjekte etmez; sadece okur.
//
// Derleme (bkz. bin/KAYNAK.txt):
//   x86_64-w64-mingw32-g++ -O2 -std=c++17 -static -s -municode -o enex-helper.exe enex-helper.cpp -luser32

#define WIN32_LEAN_AND_MEAN
#ifndef UNICODE
#define UNICODE
#endif
#include <windows.h>
#include <tlhelp32.h>
#include <stdio.h>
#include <stdlib.h>
#include <string>
#include <unordered_map>

static volatile LONG g_quit = 0;

static std::string utf8(const wchar_t* w, int len = -1) {
  if (!w) return std::string();
  if (len < 0) len = (int)wcslen(w);
  if (len == 0) return std::string();
  int n = WideCharToMultiByte(CP_UTF8, 0, w, len, NULL, 0, NULL, NULL);
  std::string s(n, '\0');
  WideCharToMultiByte(CP_UTF8, 0, w, len, &s[0], n, NULL, NULL);
  return s;
}

static std::string jstr(const std::string& s) {
  std::string o = "\"";
  for (unsigned char c : s) {
    switch (c) {
      case '"': o += "\\\""; break;
      case '\\': o += "\\\\"; break;
      case '\n': o += "\\n"; break;
      case '\r': o += "\\r"; break;
      case '\t': o += "\\t"; break;
      default:
        if (c < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); o += b; }
        else o += (char)c;
    }
  }
  return o + "\"";
}

static void out(const std::string& s) {
  if (fwrite(s.data(), 1, s.size(), stdout) != s.size() || fputc('\n', stdout) == EOF || fflush(stdout) != 0) {
    ExitProcess(0); // Enex kapandı
  }
}

static DWORD WINAPI stdinWatcher(LPVOID) {
  HANDLE h = GetStdHandle(STD_INPUT_HANDLE);
  char buf[256];
  DWORD n = 0;
  while (ReadFile(h, buf, sizeof buf, &n, NULL) && n > 0) {}
  InterlockedExchange(&g_quit, 1);
  ExitProcess(0);
  return 0;
}

// pid + dosya adı -> tam yol (her taramada tekrar tekrar açmamak için)
static std::unordered_map<DWORD, std::pair<std::wstring, std::string>> g_paths;

static std::string fullPath(DWORD pid, const wchar_t* exe) {
  auto it = g_paths.find(pid);
  if (it != g_paths.end() && it->second.first == exe) return it->second.second;
  std::string res;
  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (h) {
    wchar_t buf[1024];
    DWORD n = 1024;
    if (QueryFullProcessImageNameW(h, 0, buf, &n)) res = utf8(buf, (int)n);
    CloseHandle(h);
  }
  if (res.empty()) res = utf8(exe); // korumalı süreçler (ör. hile koruması): sadece dosya adı
  g_paths[pid] = { exe, res };
  return res;
}

static void listProcs() {
  HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snap == INVALID_HANDLE_VALUE) return;
  PROCESSENTRY32W pe;
  pe.dwSize = sizeof pe;
  std::unordered_map<DWORD, bool> alive;
  std::string s = "{\"t\":\"procs\",\"list\":[";
  bool first = true;
  if (Process32FirstW(snap, &pe)) {
    do {
      if (pe.th32ProcessID <= 4) continue;
      alive[pe.th32ProcessID] = true;
      if (!first) s += ",";
      first = false;
      s += "[" + std::to_string(pe.th32ProcessID) + "," + jstr(fullPath(pe.th32ProcessID, pe.szExeFile)) + "]";
    } while (Process32NextW(snap, &pe));
  }
  CloseHandle(snap);
  for (auto it = g_paths.begin(); it != g_paths.end();) {
    if (!alive.count(it->first)) it = g_paths.erase(it); else ++it;
  }
  out(s + "]}");
}

static std::string g_lastFg;

static std::string rectJson(const RECT& r) {
  return "[" + std::to_string(r.left) + "," + std::to_string(r.top) + "," +
         std::to_string(r.right - r.left) + "," + std::to_string(r.bottom - r.top) + "]";
}

static void checkForeground() {
  HWND fg = GetForegroundWindow();
  std::string s;
  if (!fg) {
    s = "{\"t\":\"fg\",\"pid\":0}";
  } else {
    DWORD pid = 0;
    GetWindowThreadProcessId(fg, &pid);
    wchar_t cls[128] = L"";
    GetClassNameW(fg, cls, 128);
    RECT wr = {0, 0, 0, 0};
    GetWindowRect(fg, &wr);
    HMONITOR mon = MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST);
    MONITORINFO mi;
    mi.cbSize = sizeof mi;
    GetMonitorInfoW(mon, &mi);
    const RECT& m = mi.rcMonitor;
    bool full = !IsIconic(fg) && wr.left <= m.left && wr.top <= m.top && wr.right >= m.right && wr.bottom >= m.bottom;
    // Ön plandaki sürecin tam yolu
    std::string path;
    HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (h) {
      wchar_t buf[1024];
      DWORD n = 1024;
      if (QueryFullProcessImageNameW(h, 0, buf, &n)) path = utf8(buf, (int)n);
      CloseHandle(h);
    }
    s = "{\"t\":\"fg\",\"pid\":" + std::to_string(pid) + ",\"path\":" + jstr(path) +
        ",\"cls\":" + jstr(utf8(cls)) + ",\"full\":" + (full ? "true" : "false") +
        ",\"mon\":" + rectJson(m) + ",\"win\":" + rectJson(wr) + "}";
  }
  if (s != g_lastFg) {
    g_lastFg = s;
    out(s);
  }
}

int wmain(int argc, wchar_t** argv) {
  // Koordinatlar her monitörde gerçek piksel olsun
  typedef BOOL(WINAPI * SetCtx)(HANDLE);
  HMODULE u32 = GetModuleHandleW(L"user32.dll");
  SetCtx setCtx = u32 ? (SetCtx)GetProcAddress(u32, "SetProcessDpiAwarenessContext") : NULL;
  if (setCtx) setCtx((HANDLE)-4); // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
  else SetProcessDPIAware();

  DWORD procsEvery = 5000, fgEvery = 500;
  for (int i = 1; i + 1 < argc; i++) {
    if (!wcscmp(argv[i], L"--procs")) procsEvery = (DWORD)_wtoi(argv[++i]);
    else if (!wcscmp(argv[i], L"--fg")) fgEvery = (DWORD)_wtoi(argv[++i]);
  }
  if (procsEvery < 1000) procsEvery = 1000;
  if (fgEvery < 100) fgEvery = 100;

  SetPriorityClass(GetCurrentProcess(), BELOW_NORMAL_PRIORITY_CLASS);
  CreateThread(NULL, 0, stdinWatcher, NULL, 0, NULL);

  out("{\"t\":\"ready\",\"v\":1}");
  DWORD lastProcs = 0;
  bool firstScan = true;
  while (!g_quit) {
    DWORD now = GetTickCount();
    if (firstScan || now - lastProcs >= procsEvery) {
      firstScan = false;
      lastProcs = now;
      listProcs();
    }
    checkForeground();
    Sleep(fgEvery);
  }
  return 0;
}
