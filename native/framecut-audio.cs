// FrameCut native audio helper: WASAPI capture (exclusive, raw or shared), endpoint input gain,
// and device listing. Compiled with the .NET Framework compiler included in Windows (C# 5).
//
//   framecut-audio list
//   framecut-audio gain <endpointId|default> [dB]
//   framecut-audio record <endpointId|default> <exclusive|raw|shared> <rate|0> <bits|0> <out.wav|->
//
// record writes JSON lines to stdout (started / level / done / error) and stops on "stop" via stdin.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace FrameCutAudio
{
    [StructLayout(LayoutKind.Sequential)] struct PropertyKey { public Guid fmtid; public int pid; public PropertyKey(Guid g, int p) { fmtid = g; pid = p; } }
    [StructLayout(LayoutKind.Sequential)] struct PropVariant { public ushort vt; public ushort r1, r2, r3; public IntPtr p; public IntPtr p2; }
    [StructLayout(LayoutKind.Sequential)] struct AudioClientProperties { public uint cbSize; public int bIsOffload; public int eCategory; public int Options; }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom { }
    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        int RegisterEndpointNotificationCallback(IntPtr client);
        int UnregisterEndpointNotificationCallback(IntPtr client);
    }
    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection { [PreserveSig] int GetCount(out int count); [PreserveSig] int Item(int index, out IMMDevice device); }
    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore store);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out int state);
    }
    [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetAt(int index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
        [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
        [PreserveSig] int Commit();
    }
    [ComImport, Guid("726778CD-F60A-4eda-82DE-E47610CD78AA"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioClient2 {
        [PreserveSig] int Initialize(int shareMode, int streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
        [PreserveSig] int GetBufferSize(out uint frames);
        [PreserveSig] int GetStreamLatency(out long latency);
        [PreserveSig] int GetCurrentPadding(out uint padding);
        [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
        [PreserveSig] int GetMixFormat(out IntPtr format);
        [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr handle);
        [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
        [PreserveSig] int IsOffloadCapable(int category, out int capable);
        [PreserveSig] int SetClientProperties(ref AudioClientProperties props);
        [PreserveSig] int GetBufferSizeLimits(IntPtr format, int eventDriven, out long min, out long max);
    }
    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioCaptureClient {
        [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
        [PreserveSig] int ReleaseBuffer(uint frames);
        [PreserveSig] int GetNextPacketSize(out uint frames);
    }
    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int GetChannelCount(out uint count);
        [PreserveSig] int SetMasterVolumeLevel(float levelDB, ref Guid context);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid context);
        [PreserveSig] int GetMasterVolumeLevel(out float levelDB);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int SetChannelVolumeLevel(uint channel, float levelDB, ref Guid context);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
        [PreserveSig] int GetChannelVolumeLevel(uint channel, out float levelDB);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
        [PreserveSig] int GetVolumeStepInfo(out uint step, out uint stepCount);
        [PreserveSig] int VolumeStepUp(ref Guid context);
        [PreserveSig] int VolumeStepDown(ref Guid context);
        [PreserveSig] int QueryHardwareSupport(out uint mask);
        [PreserveSig] int GetVolumeRange(out float minDB, out float maxDB, out float incrementDB);
    }

    class Fmt {
        public int Rate, Channels, Container, Valid; public bool Float;
        public int BlockAlign { get { return Channels * Container / 8; } }
        public override string ToString() { return Rate + "/" + Valid + (Float ? "f" : "") + "/" + Channels; }
        static readonly Guid PCM = new Guid("00000001-0000-0010-8000-00aa00389b71"), FLOAT = new Guid("00000003-0000-0010-8000-00aa00389b71");
        public IntPtr Alloc() {
            IntPtr p = Marshal.AllocCoTaskMem(40);
            Marshal.WriteInt16(p, 0, unchecked((short)0xFFFE)); Marshal.WriteInt16(p, 2, (short)Channels); Marshal.WriteInt32(p, 4, Rate);
            Marshal.WriteInt32(p, 8, Rate * BlockAlign); Marshal.WriteInt16(p, 12, (short)BlockAlign); Marshal.WriteInt16(p, 14, (short)Container);
            Marshal.WriteInt16(p, 16, 22); Marshal.WriteInt16(p, 18, (short)Valid); Marshal.WriteInt32(p, 20, Channels == 1 ? 4 : Channels == 2 ? 3 : (1 << Channels) - 1);
            byte[] g = (Float ? FLOAT : PCM).ToByteArray(); Marshal.Copy(g, 0, p + 24, 16); return p;
        }
        public static Fmt Read(IntPtr p) {
            Fmt f = new Fmt(); int tag = (ushort)Marshal.ReadInt16(p, 0); f.Channels = Marshal.ReadInt16(p, 2); f.Rate = Marshal.ReadInt32(p, 4); f.Container = Marshal.ReadInt16(p, 14); f.Valid = f.Container;
            if (tag == 0xFFFE) { f.Valid = Marshal.ReadInt16(p, 18); byte[] g = new byte[16]; Marshal.Copy(p + 24, g, 0, 16); f.Float = new Guid(g) == FLOAT; if (f.Valid == 0) f.Valid = f.Container; }
            else f.Float = tag == 3;
            return f;
        }
    }

    static class Program
    {
        const int eCapture = 1, DEVICE_STATE_ACTIVE = 1, CLSCTX_ALL = 23;
        const int AUDCLNT_SHAREMODE_SHARED = 0, AUDCLNT_SHAREMODE_EXCLUSIVE = 1, AUDCLNT_STREAMFLAGS_EVENTCALLBACK = 0x00040000;
        const int AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED = unchecked((int)0x88890019);
        static readonly Guid IID_IAudioClient2 = new Guid("726778CD-F60A-4eda-82DE-E47610CD78AA");
        static readonly Guid IID_IAudioCaptureClient = new Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317");
        static readonly Guid IID_IAudioEndpointVolume = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
        static readonly PropertyKey PKEY_FriendlyName = new PropertyKey(new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), 14);
        static readonly object outLock = new object();

        static void Emit(string json) { lock (outLock) { Console.Out.Write(json + "\n"); Console.Out.Flush(); } }
        static string Q(string s) { if (s == null) return "null"; var b = new StringBuilder("\""); foreach (char c in s) { if (c == '"' || c == '\\') b.Append('\\').Append(c); else if (c < 32) b.AppendFormat("\\u{0:x4}", (int)c); else b.Append(c); } return b.Append('"').ToString(); }
        static string N(double v) { return double.IsNaN(v) || double.IsInfinity(v) ? "null" : v.ToString("0.###", CultureInfo.InvariantCulture); }
        static void Check(int hr, string what) { if (hr < 0) throw new COMException(what + " failed (0x" + hr.ToString("X8") + ")", hr); }

        [STAThread]
        static int Main(string[] args)
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            try {
                if (args.Length == 0) throw new ArgumentException("usage: list | gain <id> [dB] | record <id> <mode> <rate> <bits> <out>");
                switch (args[0]) {
                    case "list": List(); return 0;
                    case "gain": Gain(args[1], args.Length > 2 ? args[2] : null); return 0;
                    case "record": return Record(args[1], args[2], int.Parse(args[3]), int.Parse(args[4]), args[5]);
                    default: throw new ArgumentException("unknown command " + args[0]);
                }
            } catch (Exception e) { Emit("{\"type\":\"error\",\"message\":" + Q(Friendly(e)) + ",\"code\":" + Q(e is COMException ? ((COMException)e).ErrorCode.ToString("X8") : e.GetType().Name) + "}"); return 1; }
        }

        static string Friendly(Exception e) {
            var c = e as COMException; if (c == null) return e.Message;
            switch ((uint)c.ErrorCode) {
                case 0x8889000A: return "The microphone is being used by another app in exclusive mode.";
                case 0x88890008: return "The microphone does not support that recording format.";
                case 0x8889000E: return "Exclusive mode is turned off for this device in Windows Sound settings (Advanced: 'Allow applications to take exclusive control').";
                case 0x88890004: return "The microphone was disconnected.";
                case 0x80070005: return "Windows blocked microphone access. Allow desktop apps to use the microphone in Privacy settings.";
                default: return c.Message;
            }
        }

        static IMMDeviceEnumerator Enumerator() { return (IMMDeviceEnumerator)new MMDeviceEnumeratorCom(); }
        static IMMDevice Device(string id) {
            var en = Enumerator(); IMMDevice d;
            if (id == "default" || string.IsNullOrEmpty(id)) Check(en.GetDefaultAudioEndpoint(eCapture, 0, out d), "Finding the default microphone");
            else if (id == "communications") Check(en.GetDefaultAudioEndpoint(eCapture, 2, out d), "Finding the communications microphone");
            else Check(en.GetDevice(id, out d), "Opening the microphone");
            return d;
        }
        static string Name(IMMDevice d) {
            IPropertyStore ps; if (d.OpenPropertyStore(0, out ps) < 0) return "Microphone";
            PropVariant v; var k = PKEY_FriendlyName; if (ps.GetValue(ref k, out v) < 0 || v.vt != 31) return "Microphone";
            return Marshal.PtrToStringUni(v.p);
        }
        static T Activate<T>(IMMDevice d, Guid iid) { object o; Check(d.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out o), "Activating the audio device"); return (T)o; }

        // Candidate exclusive formats, best first.
        static IEnumerable<Fmt> Candidates(int channels, int rate, int bits) {
            int[] rates = rate > 0 ? new[] { rate } : new[] { 48000, 96000, 44100, 88200, 192000, 176400, 32000, 24000, 22050, 16000 };
            var depths = new List<int[]>(); // container, valid, float
            if (bits == 0 || bits == 24) { depths.Add(new[] { 24, 24, 0 }); depths.Add(new[] { 32, 24, 0 }); }
            if (bits == 0 || bits == 32) { depths.Add(new[] { 32, 32, 1 }); depths.Add(new[] { 32, 32, 0 }); }
            if (bits == 0 || bits == 16) depths.Add(new[] { 16, 16, 0 });
            int[] chans = channels > 2 ? new[] { channels, 2, 1 } : new[] { channels, channels == 1 ? 2 : 1 };
            foreach (int r in rates) foreach (var dp in depths) foreach (int ch in chans)
                yield return new Fmt { Rate = r, Channels = ch, Container = dp[0], Valid = dp[1], Float = dp[2] == 1 };
        }
        static bool Supported(IAudioClient2 c, Fmt f) { IntPtr p = f.Alloc(), closest; try { return c.IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, p, out closest) == 0; } finally { Marshal.FreeCoTaskMem(p); } }

        static void List()
        {
            var en = Enumerator(); IMMDeviceCollection col; Check(en.EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE, out col), "Listing microphones");
            string defId = null; IMMDevice def; if (en.GetDefaultAudioEndpoint(eCapture, 0, out def) == 0) def.GetId(out defId);
            int n; col.GetCount(out n); var items = new List<string>();
            for (int i = 0; i < n; i++) {
                IMMDevice d; if (col.Item(i, out d) < 0) continue; string id; d.GetId(out id);
                var sb = new StringBuilder("{\"id\":" + Q(id) + ",\"name\":" + Q(Name(d)) + ",\"isDefault\":" + (id == defId ? "true" : "false"));
                try {
                    var c = Activate<IAudioClient2>(d, IID_IAudioClient2); IntPtr mp; Check(c.GetMixFormat(out mp), "Reading the format"); var mix = Fmt.Read(mp); Marshal.FreeCoTaskMem(mp);
                    sb.Append(",\"shared\":{\"rate\":" + mix.Rate + ",\"channels\":" + mix.Channels + ",\"bits\":" + mix.Valid + ",\"float\":" + (mix.Float ? "true" : "false") + "}");
                    var ex = new List<string>(); var seen = new HashSet<string>();
                    foreach (var f in Candidates(mix.Channels, 0, 0)) { string key = f.ToString(); if (seen.Contains(key)) continue; seen.Add(key); if (Supported(c, f)) ex.Add("{\"rate\":" + f.Rate + ",\"bits\":" + f.Valid + ",\"container\":" + f.Container + ",\"float\":" + (f.Float ? "true" : "false") + ",\"channels\":" + f.Channels + "}"); }
                    sb.Append(",\"exclusive\":[" + string.Join(",", ex) + "]");
                    int off; var props = new AudioClientProperties { cbSize = 16, eCategory = 0, Options = 1 };
                    bool rawOk = c.SetClientProperties(ref props) == 0; sb.Append(",\"raw\":" + (rawOk ? "true" : "false"));
                    IntPtr rp; if (rawOk && c.GetMixFormat(out rp) == 0) { var rf = Fmt.Read(rp); Marshal.FreeCoTaskMem(rp); sb.Append(",\"rawFormat\":{\"rate\":" + rf.Rate + ",\"channels\":" + rf.Channels + ",\"bits\":" + rf.Valid + ",\"float\":" + (rf.Float ? "true" : "false") + "}"); }
                    c.IsOffloadCapable(0, out off);
                } catch (Exception e) { sb.Append(",\"error\":" + Q(Friendly(e))); }
                sb.Append(",\"gain\":" + GainJson(d) + "}"); items.Add(sb.ToString());
            }
            Emit("{\"type\":\"devices\",\"devices\":[" + string.Join(",", items) + "]}");
        }

        static string GainJson(IMMDevice d) {
            try {
                var v = Activate<IAudioEndpointVolume>(d, IID_IAudioEndpointVolume);
                float min, max, inc, cur, scalar; uint hw; bool mute;
                Check(v.GetVolumeRange(out min, out max, out inc), "Reading the gain range"); v.GetMasterVolumeLevel(out cur); v.GetMasterVolumeLevelScalar(out scalar); v.QueryHardwareSupport(out hw); v.GetMute(out mute);
                return "{\"db\":" + N(cur) + ",\"scalar\":" + N(scalar) + ",\"min\":" + N(min) + ",\"max\":" + N(max) + ",\"step\":" + N(inc) + ",\"hardware\":" + ((hw & 1) != 0 ? "true" : "false") + ",\"muted\":" + (mute ? "true" : "false") + "}";
            } catch { return "null"; }
        }
        static void Gain(string id, string db)
        {
            var d = Device(id);
            if (db != null) {
                var v = Activate<IAudioEndpointVolume>(d, IID_IAudioEndpointVolume); var ctx = Guid.Empty; float min, max, inc; v.GetVolumeRange(out min, out max, out inc);
                float target = Math.Max(min, Math.Min(max, float.Parse(db, CultureInfo.InvariantCulture)));
                Check(v.SetMasterVolumeLevel(target, ref ctx), "Setting the input gain"); v.SetMute(false, ref ctx);
            }
            Emit("{\"type\":\"gain\",\"gain\":" + GainJson(d) + "}");
        }

        // ---------- Recording ----------
        static volatile bool stopRequested;
        static int Record(string id, string mode, int rate, int bits, string outPath)
        {
            var d = Device(id); string devName = Name(d), devId; d.GetId(out devId);
            IAudioClient2 client = Activate<IAudioClient2>(d, IID_IAudioClient2);
            IntPtr mixPtr; Check(client.GetMixFormat(out mixPtr), "Reading the device format"); Fmt mix = Fmt.Read(mixPtr);
            long defPeriod, minPeriod; client.GetDevicePeriod(out defPeriod, out minPeriod);
            Fmt fmt = null; bool raw = false; int share = AUDCLNT_SHAREMODE_SHARED; IntPtr fmtPtr = IntPtr.Zero;
            var evt = new AutoResetEvent(false);
            if (mode == "exclusive") {
                share = AUDCLNT_SHAREMODE_EXCLUSIVE;
                foreach (var f in Candidates(mix.Channels, rate, bits)) if (Supported(client, f)) { fmt = f; break; }
                if (fmt == null) throw new COMException("No exclusive format", unchecked((int)0x88890008));
                fmtPtr = fmt.Alloc();
                long period = defPeriod;
                int hr = client.Initialize(share, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, period, period, fmtPtr, IntPtr.Zero);
                if (hr == AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED) {
                    uint frames; client.GetBufferSize(out frames);
                    period = (long)(10000000.0 * frames / fmt.Rate + 0.5);
                    client = Activate<IAudioClient2>(d, IID_IAudioClient2);
                    hr = client.Initialize(share, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, period, period, fmtPtr, IntPtr.Zero);
                }
                Check(hr, "Starting exclusive recording");
            } else {
                int hr = -1;
                if (mode == "raw") {
                    // Raw bypasses driver/system effects (APOs). The format must be re-read after enabling it.
                    var props = new AudioClientProperties { cbSize = 16, eCategory = 0, Options = 1 };
                    if (client.SetClientProperties(ref props) == 0) {
                        IntPtr rp; if (client.GetMixFormat(out rp) == 0) { Marshal.FreeCoTaskMem(mixPtr); mixPtr = rp; mix = Fmt.Read(rp); }
                        hr = client.Initialize(share, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, 200000, 0, mixPtr, IntPtr.Zero); raw = hr >= 0;
                    }
                    if (!raw) { client = Activate<IAudioClient2>(d, IID_IAudioClient2); IntPtr np; Check(client.GetMixFormat(out np), "Reading the device format"); Marshal.FreeCoTaskMem(mixPtr); mixPtr = np; mix = Fmt.Read(np); }
                }
                fmt = mix; fmtPtr = mixPtr; mixPtr = IntPtr.Zero;
                if (!raw) hr = client.Initialize(share, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, 200000, 0, fmtPtr, IntPtr.Zero);
                Check(hr, "Starting recording");
            }
            Check(client.SetEventHandle(evt.SafeWaitHandle.DangerousGetHandle()), "Preparing the capture event");
            object svc; var iidCap = IID_IAudioCaptureClient; Check(client.GetService(ref iidCap, out svc), "Opening the capture stream");
            var cap = (IAudioCaptureClient)svc;
            long latency; client.GetStreamLatency(out latency);

            // Output: packed 24-bit for 24 valid bits, 32-bit float for float, else integer at container size.
            int outBits = fmt.Float ? 32 : fmt.Valid == 24 ? 24 : fmt.Container;
            FileStream fs = outPath == "-" ? null : new FileStream(outPath, FileMode.Create, FileAccess.Write, FileShare.Read, 1 << 16);
            if (fs != null) WriteHeader(fs, fmt.Rate, fmt.Channels, outBits, fmt.Float, 0);
            long dataBytes = 0, frameCount = 0, clipped = 0;
            int ch = fmt.Channels, bpsIn = fmt.Container / 8, bpsOut = outBits / 8;
            byte[] inBuf = new byte[0], outBuf = new byte[0];
            double[] peak = new double[ch], sumSq = new double[ch]; long meterFrames = 0;
            int wfStep = Math.Max(1, fmt.Rate / 100); double wfMin = 0, wfMax = 0; int wfN = 0; var wave = new List<string>();
            long minSample = long.MaxValue, maxSample = long.MinValue, lowBitsOr = 0; double dc = 0;
            var stdinThread = new Thread(() => { try { string line; while ((line = Console.In.ReadLine()) != null) if (line.Trim() == "stop") break; } catch { } stopRequested = true; }) { IsBackground = true };
            stdinThread.Start();

            Check(client.Start(), "Starting the microphone");
            Emit("{\"type\":\"started\",\"mode\":" + Q(mode == "exclusive" ? "exclusive" : raw ? "raw" : "shared") + ",\"rawRequested\":" + (mode == "raw" ? "true" : "false") + ",\"rate\":" + fmt.Rate + ",\"channels\":" + ch + ",\"bits\":" + fmt.Valid + ",\"container\":" + fmt.Container + ",\"float\":" + (fmt.Float ? "true" : "false") + ",\"fileBits\":" + outBits + ",\"latencyMs\":" + N(latency / 10000.0) + ",\"periodMs\":" + N(defPeriod / 10000.0) + ",\"device\":" + Q(devName) + ",\"deviceId\":" + Q(devId) + ",\"t\":" + DateTime.UtcNow.Subtract(new DateTime(1970, 1, 1)).TotalMilliseconds.ToString("0", CultureInfo.InvariantCulture) + "}");
            var sw = System.Diagnostics.Stopwatch.StartNew(); long lastEmit = 0, lastHeader = 0; int silentWaits = 0;
            try {
                while (!stopRequested) {
                    if (!evt.WaitOne(500)) { if (++silentWaits > 6) throw new COMException("Device stopped delivering audio", unchecked((int)0x88890004)); continue; }
                    silentWaits = 0;
                    uint packet; Check(cap.GetNextPacketSize(out packet), "Reading audio");
                    while (packet > 0) {
                        IntPtr data; uint frames, flags; ulong devPos, qpc;
                        Check(cap.GetBuffer(out data, out frames, out flags, out devPos, out qpc), "Reading audio");
                        int nIn = (int)frames * ch * bpsIn; if (inBuf.Length < nIn) inBuf = new byte[nIn];
                        if ((flags & 2) != 0) Array.Clear(inBuf, 0, nIn); else Marshal.Copy(data, inBuf, 0, nIn);
                        Check(cap.ReleaseBuffer(frames), "Reading audio");
                        int nOut = (int)frames * ch * bpsOut; if (outBuf.Length < nOut) outBuf = new byte[nOut];
                        for (int i = 0; i < frames * ch; i++) {
                            double v; int o = i * bpsIn, w = i * bpsOut;
                            if (fmt.Float) { v = BitConverter.ToSingle(inBuf, o); Buffer.BlockCopy(inBuf, o, outBuf, w, 4); }
                            else if (bpsIn == 2) { short s = BitConverter.ToInt16(inBuf, o); v = s / 32768.0; outBuf[w] = inBuf[o]; outBuf[w + 1] = inBuf[o + 1]; Track(s, ref minSample, ref maxSample); lowBitsOr |= (ushort)s; }
                            else if (bpsIn == 3) { int s = (inBuf[o] | (inBuf[o + 1] << 8) | ((sbyte)inBuf[o + 2] << 16)); v = s / 8388608.0; outBuf[w] = inBuf[o]; outBuf[w + 1] = inBuf[o + 1]; outBuf[w + 2] = inBuf[o + 2]; Track(s, ref minSample, ref maxSample); lowBitsOr |= s & 0xFFFFFF; }
                            else { int s = BitConverter.ToInt32(inBuf, o); v = s / 2147483648.0;
                                if (bpsOut == 3) { int s24 = s >> 8; outBuf[w] = (byte)s24; outBuf[w + 1] = (byte)(s24 >> 8); outBuf[w + 2] = (byte)(s24 >> 16); Track(s24, ref minSample, ref maxSample); lowBitsOr |= s24 & 0xFFFFFF; }
                                else { Buffer.BlockCopy(inBuf, o, outBuf, w, 4); Track(s, ref minSample, ref maxSample); lowBitsOr |= (uint)s; } }
                            int c = i % ch; double a = Math.Abs(v); if (a > peak[c]) peak[c] = a; sumSq[c] += v * v; if (a >= 0.9999) clipped++; dc += v;
                            if (c == 0) { if (wfN == 0) { wfMin = v; wfMax = v; } else { if (v < wfMin) wfMin = v; if (v > wfMax) wfMax = v; } if (++wfN >= wfStep) { wave.Add(N(wfMin) + "," + N(wfMax)); wfN = 0; } }
                        }
                        if (fs != null) fs.Write(outBuf, 0, nOut);
                        dataBytes += nOut; frameCount += frames; meterFrames += frames;
                        Check(cap.GetNextPacketSize(out packet), "Reading audio");
                    }
                    long now = sw.ElapsedMilliseconds;
                    if (now - lastEmit >= 50 && meterFrames > 0) {
                        var pk = new string[ch]; var rm = new string[ch];
                        for (int c = 0; c < ch; c++) { pk[c] = N(Db(peak[c])); rm[c] = N(Db(Math.Sqrt(sumSq[c] / meterFrames))); peak[c] = 0; sumSq[c] = 0; }
                        Emit("{\"type\":\"level\",\"peak\":[" + string.Join(",", pk) + "],\"rms\":[" + string.Join(",", rm) + "],\"clipped\":" + clipped + ",\"seconds\":" + N((double)frameCount / fmt.Rate) + ",\"wave\":[" + string.Join(",", wave) + "]}");
                        wave.Clear(); meterFrames = 0; lastEmit = now;
                        // Keep the header current so a crash or power loss still leaves a valid WAV.
                        if (fs != null && now - lastHeader >= 1000) { long pos = fs.Position; fs.Seek(0, SeekOrigin.Begin); WriteHeader(fs, fmt.Rate, fmt.Channels, outBits, fmt.Float, dataBytes); fs.Seek(pos, SeekOrigin.Begin); fs.Flush(true); lastHeader = now; }
                        if (fs != null && dataBytes > 4000000000L) { stopRequested = true; Emit("{\"type\":\"warning\",\"message\":\"Reached the 4 GB WAV limit; the take was stopped.\"}"); }
                    }
                }
            } finally {
                client.Stop();
                if (fs != null) { fs.Seek(0, SeekOrigin.Begin); WriteHeader(fs, fmt.Rate, fmt.Channels, outBits, fmt.Float, dataBytes); fs.Close(); }
                if (fmtPtr != IntPtr.Zero) Marshal.FreeCoTaskMem(fmtPtr); if (mixPtr != IntPtr.Zero) Marshal.FreeCoTaskMem(mixPtr);
            }
            // Effective resolution: how many low bits actually change (a 24-bit file fed 16-bit data shows 16).
            int effective = fmt.Float ? 32 : outBits;
            if (!fmt.Float && lowBitsOr != 0) { int z = 0; while (z < outBits && ((lowBitsOr >> z) & 1) == 0) z++; effective = outBits - z; }
            Emit("{\"type\":\"done\",\"seconds\":" + N((double)frameCount / fmt.Rate) + ",\"frames\":" + frameCount + ",\"bytes\":" + dataBytes + ",\"clipped\":" + clipped + ",\"effectiveBits\":" + effective + ",\"dcOffset\":" + N(frameCount > 0 ? dc / (frameCount * ch) : 0) + "}");
            return 0;
        }
        static void Track(long s, ref long min, ref long max) { if (s < min) min = s; if (s > max) max = s; }
        static double Db(double a) { return a <= 1e-9 ? -200 : 20 * Math.Log10(a); }
        static void WriteHeader(Stream s, int rate, int ch, int bits, bool isFloat, long dataBytes)
        {
            var w = new BinaryWriter(s, Encoding.ASCII, true); uint data = (uint)Math.Min(dataBytes, uint.MaxValue - 100);
            int block = ch * bits / 8; bool ext = ch > 2 || bits > 16; // WAVE_FORMAT_EXTENSIBLE for >16-bit and multichannel
            w.Write(Encoding.ASCII.GetBytes("RIFF")); w.Write((uint)((ext ? 60 : 36) + data)); w.Write(Encoding.ASCII.GetBytes("WAVE"));
            w.Write(Encoding.ASCII.GetBytes("fmt ")); w.Write(ext ? 40 : 16);
            w.Write((ushort)(ext ? 0xFFFE : isFloat ? 3 : 1)); w.Write((ushort)ch); w.Write(rate); w.Write(rate * block); w.Write((ushort)block); w.Write((ushort)bits);
            if (ext) { w.Write((ushort)22); w.Write((ushort)bits); w.Write(ch == 1 ? 4 : ch == 2 ? 3 : (1 << ch) - 1); w.Write((isFloat ? new Guid("00000003-0000-0010-8000-00aa00389b71") : new Guid("00000001-0000-0010-8000-00aa00389b71")).ToByteArray()); }
            w.Write(Encoding.ASCII.GetBytes("data")); w.Write(data); w.Flush();
        }
    }
}
