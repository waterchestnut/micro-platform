"""仅注册 Pdf 服务的轻量 stub（本地联调 thesis 侧 PDF 导出用；集群由 grpc_server.py 全量注册）
运行：uv run python tests/pdf_only_server.py [port]
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from concurrent import futures
import grpc

from grpcs.servers import pdf_server


def serve(port=50051):
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4), options=[
        ('grpc.max_send_message_length', 256 * 1024 * 1024),
        ('grpc.max_receive_message_length', 256 * 1024 * 1024)])
    pdf_server.register(server)
    server.add_insecure_port(f'[::]:{port}')
    server.start()
    print(f'pdf-only server on :{port}', flush=True)
    server.wait_for_termination()


if __name__ == '__main__':
    serve(int(sys.argv[1]) if len(sys.argv) > 1 else 50051)
