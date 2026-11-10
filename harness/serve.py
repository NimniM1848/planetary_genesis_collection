#!/usr/bin/env python3
"""手元で確かめるための簡易サーバー（キャッシュを使わせない）。

ふつうの `python3 -m http.server` だと、ブラウザが古い JS を覚えていて、直した内容が画面に出ないことがある。
このサーバーは、すべての応答に `Cache-Control: no-store` を付けるので、リロードだけで最新になる。

使い方:  python3 harness/serve.py [ポート=8000] [待ち受けるアドレス=127.0.0.1]
         → http://localhost:8000/ （プロジェクトのフォルダを配信する）
"""
import http.server, os, socketserver, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml'}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):  # 静かに（必要ならこの行を消す）
        pass

class Server(socketserver.TCPServer):
    allow_reuse_address = True

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    host = sys.argv[2] if len(sys.argv) > 2 else '127.0.0.1'
    with Server((host, port), Handler) as httpd:
        print(f'http://{host if host != "0.0.0.0" else "localhost"}:{port}/  で配信中（キャッシュなし）。止めるときは Ctrl+C')
        try: httpd.serve_forever()
        except KeyboardInterrupt: pass
