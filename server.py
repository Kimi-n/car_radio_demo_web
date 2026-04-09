# 云侧服务，代理请求下游服务获取音频数据
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import logging
import mimetypes
import os
from pathlib import Path
from urllib import request as urllib_request
from urllib.error import URLError, HTTPError
from urllib.parse import urlparse, parse_qs

import websocket

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# 下游服务配置
DOWNSTREAM_BASE_URL = os.environ.get("DOWNSTREAM_BASE_URL", "http://localhost:8080")
DOWNSTREAM_AUDIO_PATH = os.environ.get("DOWNSTREAM_AUDIO_PATH", "/accs/media/channelContent")
DOWNSTREAM_TIMEOUT = int(os.environ.get("DOWNSTREAM_TIMEOUT", "10"))
DOWNSTREAM_WS_TIMEOUT = int(os.environ.get("DOWNSTREAM_WS_TIMEOUT", "30"))


DEVICE_ID = os.environ.get("DEVICE_ID", "car-radio-demo-001")

# 静态文件目录
STATIC_DIR = Path(__file__).resolve().parent / "web"


DEFAULT_QUERY = "播放新闻"


def build_request_body(session_id: str, query: str = "") -> dict:
    """构造下游服务请求体"""
    effective_query = query if query else DEFAULT_QUERY
    return {
        "sessionId": session_id,
        "interactionId": "1",
        "deviceID": DEVICE_ID,
        "devF": "",
        "appVersion": "",
        "appName": "",
        "news_box": {
            "needChannel": True,
            "news": [],
            "query": effective_query,
            "category": "",
        },
        "query": effective_query,
    }


def fetch_audio_data_from_downstream(session_id: str, query: str = "") -> dict:
    """请求下游服务获取音频数据，直接透传响应"""
    url = f"{DOWNSTREAM_BASE_URL}{DOWNSTREAM_AUDIO_PATH}"
    logger.info("请求下游服务: %s, sessionId: %s, query: %s", url, session_id, query)

    body = json.dumps(build_request_body(session_id, query)).encode("utf-8")
    req = urllib_request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )

    resp = urllib_request.urlopen(req, timeout=DOWNSTREAM_TIMEOUT)
    raw = resp.read().decode("utf-8")
    return json.loads(raw)

def stream_audio_chunks(doc_id: str):
    """通过 WebSocket 连接下游服务，逐块 yield 音频数据"""
    parsed = urlparse(DOWNSTREAM_BASE_URL)
    ws_scheme = "wss" if parsed.scheme == "https" else "ws"
    ws_url = f"{ws_scheme}://{parsed.netloc}/accs/media/stream/download"
    logger.info("WebSocket 连接下游音频服务: %s, docId: %s", ws_url, doc_id)

    request_payload = json.dumps({
        "session": {},
        "events": [
            {
                "header": {
                    "namespace": "ChannelsService",
                    "name": "GetMediaChannelInfo"
                },
                "payload": {
                    "docId": doc_id
                }
            }
        ]
    })

    ws = websocket.create_connection(ws_url, timeout=DOWNSTREAM_WS_TIMEOUT)
    try:
        ws.send(request_payload)

        while True:
            opcode, data = ws.recv_data()
            if opcode == websocket.ABNF.OPCODE_BINARY:
                yield data
            elif opcode == websocket.ABNF.OPCODE_TEXT:
                msg = data.decode("utf-8", errors="replace")
                logger.info("WebSocket 收到文本消息: %s", msg[:200])
            elif opcode == websocket.ABNF.OPCODE_CLOSE:
                break
    except websocket.WebSocketConnectionClosedException:
        logger.info("WebSocket 连接已关闭，音频接收完成")
    finally:
        ws.close()


class RequestHandler(BaseHTTPRequestHandler):
    # HTTP/1.1 才支持 Transfer-Encoding: chunked
    protocol_version = "HTTP/1.1"

    def do_OPTIONS(self):
        """处理 CORS 预检请求"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)

        # 健康检查接口
        if parsed.path == '/health':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok"}).encode('utf-8'))

        # 音频流代理接口: GET /api/audio-stream?docId=xxx
        elif parsed.path == '/api/audio-stream':
            query = parse_qs(parsed.query)
            doc_id = query.get("docId", [""])[0]

            if not doc_id:
                self.send_response(400)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "缺少 docId 参数"}).encode('utf-8'))
                return

            try:
                self.send_response(200)
                self.send_header('Content-Type', 'audio/mpeg')
                self.send_header('Transfer-Encoding', 'chunked')
                self.send_header('Connection', 'close')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()

                for chunk in stream_audio_chunks(doc_id):
                    chunk_header = f"{len(chunk):X}\r\n".encode("ascii")
                    self.wfile.write(chunk_header)
                    self.wfile.write(chunk)
                    self.wfile.write(b"\r\n")
                    self.wfile.flush()

                # chunked 结束标记
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()
            except Exception as e:
                logger.error("音频流失败: %s (%s)", e, type(e).__name__)
                try:
                    self.send_response(502)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": "获取音频流失败"}).encode('utf-8'))
                except Exception:
                    pass
        else:
            self._serve_static(parsed.path)

    def _serve_static(self, url_path: str) -> None:
        """提供静态文件服务"""
        # 默认 / → /index.html
        if url_path == "/":
            url_path = "/index.html"

        # 安全检查：防止路径穿越
        safe_path = Path(os.path.normpath(url_path.lstrip("/")))
        if ".." in safe_path.parts:
            self.send_response(403)
            self.end_headers()
            return

        file_path = STATIC_DIR / safe_path

        if not file_path.is_file():
            self.send_response(404)
            self.end_headers()
            return

        content_type, _ = mimetypes.guess_type(str(file_path))
        if content_type is None:
            content_type = "application/octet-stream"

        try:
            data = file_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except OSError as e:
            logger.error("读取静态文件失败: %s", e)
            self.send_response(500)
            self.end_headers()

    def do_POST(self):
        # 获取音频数据接口 - 代理到下游服务
        if self.path == '/api/audio-data':
            try:
                # 读取前端传入的请求体，提取 sessionId
                content_length = int(self.headers.get('Content-Length', 0))
                request_body = {}
                if content_length > 0:
                    raw_body = self.rfile.read(content_length).decode('utf-8')
                    request_body = json.loads(raw_body)

                session_id = request_body.get("sessionId", "")
                query = request_body.get("query", "")

                data = fetch_audio_data_from_downstream(session_id, query)
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(data).encode('utf-8'))
            except HTTPError as e:
                logger.error("下游服务返回错误: %s %s", e.code, e.reason)
                self.send_response(502)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "下游服务返回错误", "status": e.code}).encode('utf-8'))
            except (URLError, TimeoutError) as e:
                logger.error("下游服务不可用: %s", e)
                self.send_response(502)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "下游服务不可用"}).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == '__main__':
    port = 3000
    server_address = ('', port)
    httpd = HTTPServer(server_address, RequestHandler)
    print(f"云侧服务启动成功，监听端口 {port}")
    print(f"前端页面:     http://localhost:{port}/")
    print(f"健康检查接口: http://localhost:{port}/health")
    print(f"音频数据接口: http://localhost:{port}/api/audio-data")
    print(f"音频流接口:   http://localhost:{port}/api/audio-stream?docId=xxx")
    httpd.serve_forever()
