using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using Android.App;
using Android.Content;
using Android.Content.PM;
using Android.OS;
using Android.Provider;
using Android.Webkit;
using Android.Widget;
using Uri = Android.Net.Uri;

namespace Bats;

[Activity(Label = "BATS", MainLauncher = true, Exported = true,
    ScreenOrientation = ScreenOrientation.SensorLandscape,
    ConfigurationChanges = ConfigChanges.Orientation | ConfigChanges.ScreenSize,
    Theme = "@android:style/Theme.Material.Light.NoActionBar")]
public class MainActivity : Activity
{
    const string Origin = "https://appassets.androidplatform.net";
    const int PickTree = 7101;
    WebView _view = null!;
    Uri? _tree;
    readonly ConcurrentDictionary<string, Uri> _documents = new();
    readonly object _documentLock = new();
    bool _importing;

    protected override void OnCreate(Bundle? state)
    {
        base.OnCreate(state);
        Window?.SetStatusBarColor(Android.Graphics.Color.Rgb(16, 31, 45));
        _view = new WebView(this);
        _view.Settings.JavaScriptEnabled = true;
        _view.Settings.DomStorageEnabled = true;
        _view.Settings.AllowFileAccess = false;
        _view.Settings.AllowContentAccess = false;
        _view.Settings.BlockNetworkLoads = true;
        _view.Settings.MixedContentMode = MixedContentHandling.NeverAllow;
        _view.Settings.SetSupportMultipleWindows(false);
        _view.SetWebViewClient(new LocalClient(this));
        _view.SetWebChromeClient(new Logs());
        var saved = GetPreferences(FileCreationMode.Private)!.GetString("packTree", "");
        if (!string.IsNullOrEmpty(saved)) _tree = Uri.Parse(saved);
        SetContentView(_view);
        _view.LoadUrl(Origin + "/app/index.html?source=" + (_tree is null ? "demo" : "pack"));
    }

    void ChoosePack()
    {
        var intent = new Intent(Intent.ActionOpenDocumentTree);
        intent.AddFlags(ActivityFlags.GrantReadUriPermission | ActivityFlags.GrantPersistableUriPermission);
        StartActivityForResult(intent, PickTree);
    }

    protected override async void OnActivityResult(int requestCode, Result resultCode, Intent? data)
    {
        base.OnActivityResult(requestCode, resultCode, data);
        if (requestCode != PickTree || resultCode != Result.Ok || data?.Data is null || _importing) return;
        _importing = true;
        var candidate = data.Data;
        var hadGrant = ContentResolver!.PersistedUriPermissions!.Any(p => p.Uri?.ToString() == candidate.ToString() && p.IsReadPermission);
        try
        {
            ContentResolver!.TakePersistableUriPermission(candidate, ActivityFlags.GrantReadUriPermission);
            Toast.MakeText(this, "正在检查资源目录…", ToastLength.Short)?.Show();
            await Task.Run(() => ValidateCatalog(candidate));
            _tree = candidate;
            GetPreferences(FileCreationMode.Private)!.Edit()!.PutString("packTree", _tree!.ToString())!.Apply();
            _view.LoadUrl(Origin + "/app/index.html?source=pack");
        }
        catch (Exception ex)
        {
            if (!hadGrant)
                try { ContentResolver!.ReleasePersistableUriPermission(candidate, ActivityFlags.GrantReadUriPermission); } catch { }
            Toast.MakeText(this, "未导入：请选择直接包含 catalog.json 和 visuals 的资源包目录。" + ex.Message, ToastLength.Long)?.Show();
            Android.Util.Log.Warn("BAHalls", "PACK_REJECTED " + ex.Message);
        }
        finally { _importing = false; }
    }

    void ValidateCatalog(Uri tree)
    {
        using var input = ContentResolver!.OpenInputStream(ResolveDocument(tree, "catalog.json"))!;
        using var buffer = new MemoryStream();
        var bytes = new byte[65536];
        int count;
        while ((count = input.Read(bytes, 0, bytes.Length)) > 0)
        {
            if (buffer.Length + count > 32 * 1024 * 1024) throw new InvalidDataException("目录文件过大。");
            buffer.Write(bytes, 0, count);
        }
        buffer.Position = 0;
        using var doc = JsonDocument.Parse(buffer);
        var root = doc.RootElement;
        if (!root.TryGetProperty("schemaVersion", out var version) || version.GetInt32() != 1 ||
            !root.TryGetProperty("scenes", out var scenes) || scenes.ValueKind != JsonValueKind.Array ||
            scenes.GetArrayLength() is < 1 or > 10000)
            throw new InvalidDataException("不支持的目录格式。");
        ResolveDocument(tree, "visuals");
        Android.Util.Log.Info("BAHalls", "PACK_ACCEPTED scenes=" + scenes.GetArrayLength());
    }

    Uri ResolveDocument(Uri tree, string path)
    {
        // Scope cached document IDs by tree: pending requests from the previous
        // pack must never resolve through a newly selected directory.
        var treeKey = tree + "|";
        lock (_documentLock)
        {
        if (_documents.TryGetValue(treeKey + path, out var hit)) return hit;
        var segments = path.Split('/');
        var parentId = DocumentsContract.GetTreeDocumentId(tree)!;
        string prefix = "";
        foreach (var segment in segments)
        {
            prefix = prefix.Length == 0 ? segment : prefix + "/" + segment;
            if (_documents.TryGetValue(treeKey + prefix, out hit)) { parentId = DocumentsContract.GetDocumentId(hit)!; continue; }
            var children = DocumentsContract.BuildChildDocumentsUriUsingTree(tree, parentId)!;
            using var cursor = ContentResolver!.Query(children,
                new[] { DocumentsContract.Document.ColumnDocumentId, DocumentsContract.Document.ColumnDisplayName }, null, null, null);
            var parentPrefix = prefix.Contains('/') ? prefix[..prefix.LastIndexOf('/')] + "/" : "";
            while (cursor?.MoveToNext() == true)
            {
                var child = DocumentsContract.BuildDocumentUriUsingTree(tree, cursor.GetString(0))!;
                _documents[treeKey + parentPrefix + cursor.GetString(1)] = child;
            }
            if (!_documents.TryGetValue(treeKey + prefix, out hit)) throw new FileNotFoundException(prefix);
            parentId = DocumentsContract.GetDocumentId(hit)!;
        }
        return _documents[treeKey + path];
        }
    }

    WebResourceResponse LoadLocal(string url)
    {
        try
        {
            var uri = new System.Uri(url);
            if (uri.Scheme != "https" || uri.Host != "appassets.androidplatform.net" || !uri.IsDefaultPort)
                return Error(403, "Forbidden");
            var path = System.Uri.UnescapeDataString(uri.AbsolutePath).TrimStart('/');
            if (path.Contains('\\') || path.Split('/').Any(p => p is "" or "." or "..")) return Error(400, "Invalid path");
            Stream input;
            if (path.StartsWith("app/", StringComparison.Ordinal)) input = Assets!.Open("web/" + path[4..]);
            else if (path.StartsWith("demo/", StringComparison.Ordinal)) input = Assets!.Open(path);
            else if (path.StartsWith("pack/", StringComparison.Ordinal) && _tree is { } tree)
                input = ContentResolver!.OpenInputStream(ResolveDocument(tree, path[5..]))!;
            else return Error(404, "Select a resource pack");
            var mime = Path.GetExtension(path).ToLowerInvariant() switch
            {
                ".html" => "text/html", ".js" or ".mjs" => "application/javascript", ".css" => "text/css",
                ".json" => "application/json", ".png" => "image/png", ".jpg" => "image/jpeg",
                ".atlas" or ".txt" => "text/plain", ".ogg" => "audio/ogg", _ => "application/octet-stream"
            };
            return new WebResourceResponse(mime, "UTF-8", 200, "OK",
                new Dictionary<string,string> { ["Cache-Control"] = "no-store", ["X-Content-Type-Options"] = "nosniff" }, input);
        }
        catch (Exception ex)
        {
            Android.Util.Log.Warn("BAHalls", "Local resource read: " + ex.Message);
            return Error(404, "Missing local resource");
        }
    }

    static WebResourceResponse Error(int status, string text) => new("text/plain", "UTF-8", status, text,
        new Dictionary<string,string>(), new MemoryStream(Encoding.UTF8.GetBytes(text)));

    class LocalClient(MainActivity owner) : WebViewClient
    {
        public override WebResourceResponse? ShouldInterceptRequest(WebView? view, IWebResourceRequest? request)
            => owner.LoadLocal(request?.Url?.ToString() ?? "");
        public override bool ShouldOverrideUrlLoading(WebView? view, IWebResourceRequest? request)
        {
            var url = request?.Url?.ToString() ?? "";
            if (url == "offline://choose/") { owner.RunOnUiThread(owner.ChoosePack); return true; }
            return !url.StartsWith(Origin + "/app/", StringComparison.Ordinal);
        }
    }
    class Logs : WebChromeClient
    {
        public override bool OnConsoleMessage(ConsoleMessage? message)
        {
            Android.Util.Log.Info("BAHalls", message?.Message() ?? "");
            return true;
        }
    }
    protected override void OnPause() { _view.EvaluateJavascript("window.hallHostPause?.(true)", null); _view.OnPause(); base.OnPause(); }
    protected override void OnResume() { base.OnResume(); _view.OnResume(); _view.EvaluateJavascript("window.hallHostPause?.(false)", null); }
    protected override void OnDestroy() { _view.Destroy(); base.OnDestroy(); }
}
