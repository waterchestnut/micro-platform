from grpcs.servers import nlp_analyzer_pb2_grpc, nlp_analyzer_pb2
import spacy


class NlpAnalyzer(nlp_analyzer_pb2_grpc.NlpAnalyzerServicer):

    def text2Sents(self, request, context):
        sents = []
        error_msg = ''
        try:
            nlp = spacy.load('zh_core_web_lg' if request.language.startswith('zh') else 'en_core_web_sm')
            doc = nlp(request.text)
            for sent in doc.sents:
                sents.append(sent.text)
        except Exception as e:
            error_msg = str(e)
        return nlp_analyzer_pb2.SentsResponse(sents=sents, errorMsg=error_msg)


def register(server):
    nlp_analyzer_pb2_grpc.add_NlpAnalyzerServicer_to_server(NlpAnalyzer(), server)
