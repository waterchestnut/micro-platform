import sys
import os
from concurrent import futures
import grpc

from grpcs.servers import helloworld_server, extractor_server, nlp_analyzer_server, converter_server


def serve():
    max_message_length = 256 * 1024 * 1024
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10), options=[
        ('grpc.max_send_message_length', max_message_length),
        ('grpc.max_receive_message_length', max_message_length)])

    helloworld_server.register(server)
    extractor_server.register(server)
    nlp_analyzer_server.register(server)
    converter_server.register(server)

    server.add_insecure_port('[::]:50051')
    server.start()
    server.wait_for_termination()


if __name__ == '__main__':
    serve()
