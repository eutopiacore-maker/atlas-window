using System.Diagnostics;
using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Atlas.Host.Service;

public static class Program
{
    public static async Task Main(string[] args)
    {
        var builder = Host.CreateApplicationBuilder(args);
        builder.Services.AddWindowsService(options => options.ServiceName = "Atlas Host");
        builder.Services.AddSingleton<AtlasPaths>();
        builder.Services.AddSingleton<AtlasRuntime>();
        builder.Services.AddHostedService<Worker>();
        await builder.Build().RunAsync();
    }
}

public sealed class AtlasPaths
{
    public string Root { get; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Atlas");
    public string Bin => Path.Combine(Root, "bin");
    public string Runtime => Path.Combine(Root, "runtime");
    public string NodeExe => Path.Combine(Runtime, "node", "node.exe");
    public string Slots => Path.Combine(Root, "slots");
    public string Data => Path.Combine(Root, "data");
    public string Logs => Path.Combine(Root, "logs");
    public string Addons => Path.Combine(Root, "addons");
    public string ActiveMarker => Path.Combine(Root, "active-slot.txt");
    public string DesiredState => Path.Combine(Data, "desired-state.json");
    public string GenerationFile => Path.Combine(Data, "desired-generation.txt");
    public string WorldState => Path.Combine(Data, "world-state.json");
    public string InstalledAddons => Path.Combine(Data, "installed-addons.json");

    public void Ensure()
    {
        foreach (var p in new[] { Root, Bin, Runtime, Slots, Data, Logs, Addons, Path.Combine(Slots, "A"), Path.Combine(Slots, "B") })
            Directory.CreateDirectory(p);
        if (!File.Exists(ActiveMarker)) File.WriteAllText(ActiveMarker, "A");
    }

    public string ActiveSlotName
    {
        get
        {
            var n = File.Exists(ActiveMarker) ? File.ReadAllText(ActiveMarker).Trim().ToUpperInvariant() : "A";
            return n == "B" ? "B" : "A";
        }
    }

    public string ActiveSlot => Path.Combine(Slots, ActiveSlotName);
    public string InactiveSlot => Path.Combine(Slots, ActiveSlotName == "A" ? "B" : "A");
}

public sealed class AtlasRuntime
{
    private const string RepoArchive = "https://github.com/eutopiacore-maker/atlas-window/archive/refs/heads/main.zip";
    private const string DesiredStateUrl = "https://raw.githubusercontent.com/eutopiacore-maker/atlas-window/main/pc-node/desired-state.json";
    private readonly AtlasPaths _p;
    private readonly ILogger<AtlasRuntime> _log;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(20) };
    private readonly SemaphoreSlim _sync = new(1, 1);
    private readonly SemaphoreSlim _world = new(1, 1);
    private volatile bool _online;
    private volatile bool _worldHealthy;
    private volatile string? _lastError;
    private DateTimeOffset _lastWorldRun;
    private int _desiredGeneration;

    public AtlasRuntime(AtlasPaths paths, ILogger<AtlasRuntime> log)
    {
        _p = paths;
        _log = log;
        _p.Ensure();
        _desiredGeneration = ReadInt(_p.GenerationFile);
    }

    public object Status => new
    {
        schema = 1,
        nodeId = Environment.MachineName,
        state = "ENROLLED",
        online = _online,
        worldHealthy = _worldHealthy,
        hostHealthy = true,
        translatorHealthy = false,
        transportHealthy = _online,
        runtimeVersion = typeof(AtlasRuntime).Assembly.GetName().Version?.ToString(),
        gpu = DetectGpuLabel(),
        activeSlot = _p.ActiveSlotName,
        desiredGeneration = _desiredGeneration,
        lastWorldRun = _lastWorldRun == default ? null : _lastWorldRun,
        lastError = _lastError
    };

    public async Task ControlTickAsync(CancellationToken ct)
    {
        try
        {
            using var r = await _http.GetAsync(DesiredStateUrl + "?v=" + DateTimeOffset.UtcNow.ToUnixTimeSeconds(), ct);
            r.EnsureSuccessStatusCode();
            var json = await r.Content.ReadAsStringAsync(ct);
            _online = true;
            _lastError = null;
            await AtomicWriteAsync(_p.DesiredState, json, ct);

            using var doc = JsonDocument.Parse(json);
            var generation = doc.RootElement.TryGetProperty("generation", out var g) && g.TryGetInt32(out var n) ? n : _desiredGeneration;
            if (generation > _desiredGeneration)
            {
                await SyncRepositorySnapshotAsync(generation, ct);
                _desiredGeneration = generation;
                await AtomicWriteAsync(_p.GenerationFile, generation.ToString(), ct);
            }

            if (doc.RootElement.TryGetProperty("addons", out var addons) && addons.TryGetProperty("requested", out var requested) && requested.ValueKind == JsonValueKind.Array)
            {
                foreach (var a in requested.EnumerateArray())
                {
                    var id = a.ValueKind == JsonValueKind.String ? a.GetString() : a.TryGetProperty("id", out var x) ? x.GetString() : null;
                    if (!string.IsNullOrWhiteSpace(id)) await InstallAddonAsync(id!, ct);
                }
            }
        }
        catch (Exception ex)
        {
            _online = false;
            _lastError = "control: " + ex.Message;
            Event("control-offline", ex.Message);
        }
    }

    public async Task RunWorldAsync(CancellationToken ct)
    {
        if (!await _world.WaitAsync(0, ct)) return;
        try
        {
            var slot = _p.ActiveSlot;
            var runner = Path.Combine(slot, "host-node", "runtime", "world-runner.js");
            if (!File.Exists(_p.NodeExe) || !File.Exists(runner) || !File.Exists(Path.Combine(slot, "world-engine.js")))
            {
                _worldHealthy = false;
                _lastError = "World runtime is incomplete.";
                return;
            }

            if (File.Exists(_p.WorldState)) File.Copy(_p.WorldState, Path.Combine(slot, "world-state.json"), true);

            var psi = new ProcessStartInfo(_p.NodeExe, Quote(runner))
            {
                WorkingDirectory = slot,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            psi.Environment["ATLAS_OFFLINE"] = _online ? "0" : "1";
            using var proc = Process.Start(psi) ?? throw new InvalidOperationException("Could not start world runtime.");
            var stdout = await proc.StandardOutput.ReadToEndAsync(ct);
            var stderr = await proc.StandardError.ReadToEndAsync(ct);
            await proc.WaitForExitAsync(ct);
            if (proc.ExitCode != 0) throw new InvalidOperationException(string.IsNullOrWhiteSpace(stderr) ? stdout : stderr);

            var slotState = Path.Combine(slot, "world-state.json");
            if (File.Exists(slotState)) await AtomicCopyAsync(slotState, _p.WorldState, ct);
            _worldHealthy = true;
            _lastWorldRun = DateTimeOffset.UtcNow;
            _lastError = null;
        }
        catch (Exception ex)
        {
            _worldHealthy = false;
            _lastError = "world: " + ex.Message;
            Event("world-failure", ex.ToString());
        }
        finally { _world.Release(); }
    }

    public async Task SyncRepositorySnapshotAsync(int generation, CancellationToken ct)
    {
        await _sync.WaitAsync(ct);
        var temp = Path.Combine(_p.Root, "stage-" + Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(temp);
            var zipPath = Path.Combine(temp, "repo.zip");
            var bytes = await _http.GetByteArrayAsync(RepoArchive, ct);
            await File.WriteAllBytesAsync(zipPath, bytes, ct);
            var extract = Path.Combine(temp, "extract");
            ZipFile.ExtractToDirectory(zipPath, extract);
            var source = Directory.GetDirectories(extract).Single();
            var inactive = _p.InactiveSlot;
            if (Directory.Exists(inactive)) Directory.Delete(inactive, true);
            CopyDirectory(source, inactive);
            if (File.Exists(_p.WorldState)) File.Copy(_p.WorldState, Path.Combine(inactive, "world-state.json"), true);

            foreach (var required in new[] { "world-engine.js", "host.html", "index.html", Path.Combine("host-node", "runtime", "world-runner.js") })
                if (!File.Exists(Path.Combine(inactive, required))) throw new InvalidDataException("Missing required runtime file: " + required);

            if (File.Exists(_p.NodeExe))
            {
                var check = await RunProcessAsync(_p.NodeExe, "--check " + Quote(Path.Combine(inactive, "world-engine.js")), inactive, ct);
                if (check.ExitCode != 0) throw new InvalidDataException("world-engine.js failed syntax validation: " + check.Error);
            }

            var newSlot = Path.GetFileName(inactive);
            var markerTmp = _p.ActiveMarker + ".new";
            await File.WriteAllTextAsync(markerTmp, newSlot, ct);
            File.Move(markerTmp, _p.ActiveMarker, true);
            Event("slot-promoted", $"generation={generation}; slot={newSlot}");
        }
        catch (Exception ex)
        {
            Event("slot-rejected", ex.ToString());
            throw;
        }
        finally
        {
            try { if (Directory.Exists(temp)) Directory.Delete(temp, true); } catch { }
            _sync.Release();
        }
    }

    public async Task<(bool ok, string message)> InstallAddonAsync(string id, CancellationToken ct)
    {
        try
        {
            var catalogPath = Path.Combine(_p.ActiveSlot, "addons", "catalog.json");
            if (!File.Exists(catalogPath)) return (false, "Catalog unavailable.");
            using var doc = JsonDocument.Parse(await File.ReadAllTextAsync(catalogPath, ct));
            JsonElement found = default;
            var exists = false;
            foreach (var a in doc.RootElement.GetProperty("addons").EnumerateArray())
                if (string.Equals(a.GetProperty("id").GetString(), id, StringComparison.OrdinalIgnoreCase)) { found = a; exists = true; break; }
            if (!exists) return (false, "Add-on not found.");
            if (!found.TryGetProperty("installable", out var inst) || !inst.GetBoolean()) return (false, "Add-on is not installable yet.");
            if (!found.TryGetProperty("artifactUrl", out var u) || string.IsNullOrWhiteSpace(u.GetString())) return (false, "Artifact URL missing.");

            var version = found.TryGetProperty("version", out var v) ? v.GetString() ?? "unknown" : "unknown";
            var installDir = Path.Combine(_p.Addons, Safe(id), Safe(version));
            if (Directory.Exists(installDir)) return (true, "Already installed.");
            var payload = await _http.GetByteArrayAsync(u.GetString()!, ct);
            if (found.TryGetProperty("sha256", out var h) && !string.IsNullOrWhiteSpace(h.GetString()))
            {
                var actual = Convert.ToHexString(SHA256.HashData(payload)).ToLowerInvariant();
                if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(actual), Encoding.ASCII.GetBytes(h.GetString()!.ToLowerInvariant())))
                    throw new InvalidDataException("Add-on hash mismatch.");
            }
            var stage = installDir + ".stage-" + Guid.NewGuid().ToString("N");
            Directory.CreateDirectory(stage);
            var z = Path.Combine(stage, "payload.zip");
            await File.WriteAllBytesAsync(z, payload, ct);
            ZipFile.ExtractToDirectory(z, Path.Combine(stage, "content"));
            File.Delete(z);
            Directory.CreateDirectory(Path.GetDirectoryName(installDir)!);
            Directory.Move(Path.Combine(stage, "content"), installDir);
            Directory.Delete(stage, true);
            Event("addon-installed", id + "@" + version);
            return (true, "Installed.");
        }
        catch (Exception ex)
        {
            Event("addon-failure", id + ": " + ex.Message);
            return (false, ex.Message);
        }
    }

    public string GetWebRoot() => _p.ActiveSlot;
    public string GetWorldStatePath() => _p.WorldState;

    public void Event(string type, string detail)
    {
        try
        {
            Directory.CreateDirectory(_p.Logs);
            var line = JsonSerializer.Serialize(new { at = DateTimeOffset.UtcNow, type, detail }) + Environment.NewLine;
            File.AppendAllText(Path.Combine(_p.Logs, "events.jsonl"), line);
        }
        catch { }
        _log.LogInformation("{Type}: {Detail}", type, detail);
    }

    private static string DetectGpuLabel()
    {
        try
        {
            using var p = Process.Start(new ProcessStartInfo("powershell.exe", "-NoProfile -Command \"(Get-CimInstance Win32_VideoController | Select-Object -First 1 -ExpandProperty Name)\"") { UseShellExecute = false, RedirectStandardOutput = true, CreateNoWindow = true });
            var s = p?.StandardOutput.ReadToEnd().Trim();
            p?.WaitForExit(1500);
            return string.IsNullOrWhiteSpace(s) ? "Unknown" : s;
        }
        catch { return "Unknown"; }
    }

    private static int ReadInt(string path) => File.Exists(path) && int.TryParse(File.ReadAllText(path).Trim(), out var n) ? n : 0;
    private static string Safe(string s) => string.Concat(s.Select(c => char.IsLetterOrDigit(c) || c is '.' or '-' or '_' ? c : '_'));
    private static string Quote(string s) => "\"" + s.Replace("\"", "\\\"") + "\"";

    private static async Task AtomicWriteAsync(string path, string content, CancellationToken ct)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var tmp = path + ".tmp";
        await File.WriteAllTextAsync(tmp, content, ct);
        File.Move(tmp, path, true);
    }

    private static async Task AtomicCopyAsync(string src, string dst, CancellationToken ct)
    {
        var tmp = dst + ".tmp";
        await using (var a = File.OpenRead(src))
        await using (var b = File.Create(tmp)) await a.CopyToAsync(b, ct);
        File.Move(tmp, dst, true);
    }

    private static void CopyDirectory(string source, string dest)
    {
        Directory.CreateDirectory(dest);
        foreach (var f in Directory.GetFiles(source)) File.Copy(f, Path.Combine(dest, Path.GetFileName(f)), true);
        foreach (var d in Directory.GetDirectories(source)) CopyDirectory(d, Path.Combine(dest, Path.GetFileName(d)));
    }

    private static async Task<(int ExitCode, string Output, string Error)> RunProcessAsync(string exe, string args, string cwd, CancellationToken ct)
    {
        var psi = new ProcessStartInfo(exe, args) { WorkingDirectory = cwd, UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true };
        using var p = Process.Start(psi) ?? throw new InvalidOperationException("Cannot start " + exe);
        var o = await p.StandardOutput.ReadToEndAsync(ct); var e = await p.StandardError.ReadToEndAsync(ct);
        await p.WaitForExitAsync(ct);
        return (p.ExitCode, o, e);
    }
}

public sealed class Worker : BackgroundService
{
    private readonly AtlasRuntime _runtime;
    private readonly ILogger<Worker> _log;
    public Worker(AtlasRuntime runtime, ILogger<Worker> log) { _runtime = runtime; _log = log; }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _runtime.Event("host-start", Environment.MachineName);
        var server = RunServerAsync(stoppingToken);
        var control = RunControlLoopAsync(stoppingToken);
        var world = RunWorldLoopAsync(stoppingToken);
        await Task.WhenAll(server, control, world);
    }

    private async Task RunControlLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await _runtime.ControlTickAsync(ct);
            try { await Task.Delay(TimeSpan.FromSeconds(20), ct); } catch (OperationCanceledException) { }
        }
    }

    private async Task RunWorldLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await _runtime.RunWorldAsync(ct);
            try { await Task.Delay(TimeSpan.FromMinutes(1), ct); } catch (OperationCanceledException) { }
        }
    }

    private async Task RunServerAsync(CancellationToken ct)
    {
        using var listener = new HttpListener();
        listener.Prefixes.Add("http://127.0.0.1:8766/");
        listener.Start();
        _runtime.Event("local-api", "http://127.0.0.1:8766/");
        while (!ct.IsCancellationRequested)
        {
            HttpListenerContext context;
            try { context = await listener.GetContextAsync().WaitAsync(ct); }
            catch (OperationCanceledException) { break; }
            _ = Task.Run(() => HandleAsync(context, ct), CancellationToken.None);
        }
    }

    private async Task HandleAsync(HttpListenerContext c, CancellationToken ct)
    {
        try
        {
            var path = Uri.UnescapeDataString(c.Request.Url?.AbsolutePath.TrimStart('/') ?? "");
            if (path is "health") { await JsonAsync(c, new { ok = true, status = _runtime.Status }, 200, ct); return; }
            if (path is "status" or "pc-node/node-status.json") { await JsonAsync(c, _runtime.Status, 200, ct); return; }
            if (path == "world-state.json") { await FileAsync(c, _runtime.GetWorldStatePath(), "application/json", ct); return; }
            if (path == "api/addons/install" && c.Request.HttpMethod == "POST")
            {
                using var reader = new StreamReader(c.Request.InputStream, c.Request.ContentEncoding);
                using var doc = JsonDocument.Parse(await reader.ReadToEndAsync(ct));
                var id = doc.RootElement.TryGetProperty("id", out var x) ? x.GetString() : null;
                if (string.IsNullOrWhiteSpace(id)) { await JsonAsync(c, new { ok = false, error = "id required" }, 400, ct); return; }
                var r = await _runtime.InstallAddonAsync(id!, ct);
                await JsonAsync(c, new { ok = r.ok, message = r.message }, r.ok ? 200 : 409, ct); return;
            }

            if (string.IsNullOrWhiteSpace(path)) path = "host.html";
            var root = Path.GetFullPath(_runtime.GetWebRoot());
            var full = Path.GetFullPath(Path.Combine(root, path.Replace('/', Path.DirectorySeparatorChar)));
            if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !File.Exists(full)) { c.Response.StatusCode = 404; c.Response.Close(); return; }
            await FileAsync(c, full, Mime(full), ct);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Local API request failed");
            try { c.Response.StatusCode = 500; c.Response.Close(); } catch { }
        }
    }

    private static async Task JsonAsync(HttpListenerContext c, object value, int code, CancellationToken ct)
    {
        var b = JsonSerializer.SerializeToUtf8Bytes(value, new JsonSerializerOptions { WriteIndented = true });
        c.Response.StatusCode = code; c.Response.ContentType = "application/json; charset=utf-8"; c.Response.ContentLength64 = b.Length;
        await c.Response.OutputStream.WriteAsync(b, ct); c.Response.Close();
    }

    private static async Task FileAsync(HttpListenerContext c, string path, string mime, CancellationToken ct)
    {
        if (!File.Exists(path)) { c.Response.StatusCode = 404; c.Response.Close(); return; }
        c.Response.StatusCode = 200; c.Response.ContentType = mime;
        await using var f = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        c.Response.ContentLength64 = f.Length; await f.CopyToAsync(c.Response.OutputStream, ct); c.Response.Close();
    }

    private static string Mime(string p) => Path.GetExtension(p).ToLowerInvariant() switch
    {
        ".html" => "text/html; charset=utf-8", ".js" => "text/javascript; charset=utf-8", ".css" => "text/css; charset=utf-8",
        ".json" => "application/json; charset=utf-8", ".png" => "image/png", ".jpg" or ".jpeg" => "image/jpeg", ".svg" => "image/svg+xml", _ => "application/octet-stream"
    };
}
