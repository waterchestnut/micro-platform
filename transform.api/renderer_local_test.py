# 临时：渲染 gRPC 本地回环测试（仅注册 Renderer，避免加载 spacy 大模型）
import time
import json
import grpc
from concurrent import futures

from grpcs.servers import renderer_server, renderer_pb2, renderer_pb2_grpc


def main():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=2),
                         options=[('grpc.max_send_message_length', 256 * 1024 * 1024),
                                  ('grpc.max_receive_message_length', 256 * 1024 * 1024)])
    renderer_server.register(server)
    server.add_insecure_port('[::]:50999')
    server.start()
    try:
        channel = grpc.insecure_channel('localhost:50999')
        stub = renderer_pb2_grpc.RendererStub(channel)
        t0 = time.time()
        resp = stub.renderDemo(renderer_pb2.DemoRenderRequest(
            kind='projectile',
            params=json.dumps({'v0': 18, 'angleDeg': 40, 'color': '#2563EB', 'bg': '#F8FAFC'}),
            width=640, height=360, fps=20, seconds=6.0,
        ))
        print('projectile ok: video=%d poster=%d meta=%s cost=%.1fs' % (
            len(resp.video), len(resp.poster), resp.meta, time.time() - t0))
        # 错误分支：未知 kind
        try:
            stub.renderDemo(renderer_pb2.DemoRenderRequest(kind='nope'))
            print('ERROR: invalid kind did not raise')
        except grpc.RpcError as e:
            print('invalid kind ->', e.code().name, e.details()[:60])
        # 错误分支：非法params
        try:
            stub.renderDemo(renderer_pb2.DemoRenderRequest(kind='wave', params='{bad'))
            print('ERROR: bad params did not raise')
        except grpc.RpcError as e:
            print('bad params ->', e.code().name, e.details()[:60])
    finally:
        server.stop(0)


if __name__ == '__main__':
    main()
