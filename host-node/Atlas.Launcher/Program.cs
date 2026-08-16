using System.Diagnostics;

namespace Atlas.Launcher;

public static class Program
{
    [STAThread]
    public static void Main()
    {
        const string url = "http://127.0.0.1:8766/host.html";
        try
        {
            var edge = FindEdge();
            if (edge is not null)
            {
                Process.Start(new ProcessStartInfo(edge, $"--app={url} --start-maximized") { UseShellExecute = true });
                return;
            }
        }
        catch { }

        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch { }
    }

    private static string? FindEdge()
    {
        var candidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe")
        };
        return candidates.FirstOrDefault(File.Exists);
    }
}
