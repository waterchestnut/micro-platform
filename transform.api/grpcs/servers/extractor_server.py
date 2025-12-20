from grpcs.servers import extractor_pb2_grpc, extractor_pb2
from bs4 import BeautifulSoup
from docx import Document
from io import BytesIO

from services.excel import get_xls_text, get_csv_text, get_xlsx_text
from services.pdf import get_pdf_text


class Extractor(extractor_pb2_grpc.ExtractorServicer):

    def pdf2Text(self, request, context):
        text = get_pdf_text(request.content, request.language == 'ocr')
        return extractor_pb2.TextExtractorResponse(text=text)

    def word2Text(self, request, context):
        doc = Document(BytesIO(request.content))
        texts = []
        for paragraph in doc.paragraphs:
            if paragraph.text.strip():
                texts.append(paragraph.text.strip())
            else:
                texts.append('\n')
        text = '\n'.join(texts)
        return extractor_pb2.TextExtractorResponse(text=text)

    def excel2Text(self, request, context):
        if request.language == 'xls':
            text = get_xls_text(request.content)
        elif request.language == 'csv':
            text = get_csv_text(request.content)
        else:
            text = get_xlsx_text(request.content)

        return extractor_pb2.TextExtractorResponse(text=text)

    def html2Text(self, request, context):
        with open(request.content, "rb") as fp:
            soup = BeautifulSoup(fp, "html.parser")
            text = soup.get_text()
            text = text.strip() if text else ""
        return extractor_pb2.TextExtractorResponse(text=text)


def register(server):
    extractor_pb2_grpc.add_ExtractorServicer_to_server(Extractor(), server)
