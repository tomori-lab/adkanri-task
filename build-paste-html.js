const fs = require('fs');
const c = fs.readFileSync('GAS貼り付け用_index.html', 'utf8');
const e = c.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GAS 貼り付け用 - コピー</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: sans-serif; background: #1e293b; color: #f1f5f9; padding: 16px; }
    .toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
    .btn { padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; }
    .btn:hover { background: #2563eb; }
    .btn.done { background: #22c55e; }
    .hint { font-size: 13px; color: #94a3b8; }
    #content { width: 100%; height: calc(100vh - 80px); font-family: Consolas, monospace; font-size: 12px; padding: 12px; background: #0f172a; color: #e2e8f0; border: 1px solid #475569; border-radius: 6px; resize: none; }
  </style>
</head>
<body>
  <div class="toolbar">
    <button class="btn" id="copyBtn">クリップボードにコピー</button>
    <span class="hint">→ script.google.com で Index.html を開き、全選択(Ctrl+A)してから貼り付け(Ctrl+V)</span>
  </div>
  <textarea id="content" readonly>${e}</textarea>
  <script>
    document.getElementById('copyBtn').onclick = function() {
      var ta = document.getElementById('content');
      ta.select();
      document.execCommand('copy');
      var btn = document.getElementById('copyBtn');
      btn.textContent = 'コピーしました！';
      btn.classList.add('done');
      setTimeout(function(){ btn.textContent = 'クリップボードにコピー'; btn.classList.remove('done'); }, 2000);
    };
  </script>
</body>
</html>
`;
fs.writeFileSync('GAS貼り付け.html', html, 'utf8');
console.log('GAS貼り付け.html を生成しました');
