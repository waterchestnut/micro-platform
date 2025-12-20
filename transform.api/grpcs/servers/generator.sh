python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. ./grpcs/servers/extractor.proto
python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. ./grpcs/servers/nlp_analyzer.proto
python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. ./grpcs/servers/converter.proto