import base64

import spacy
from PIL import Image

from services.ocr import image_ocr_openai, image_ocr_xin
from services.pdf import get_pdf_text


def print_hi():
    nlp = spacy.load('zh_core_web_lg')
    # a导入英文模型
    doc = nlp('补充：一般导入语料都有nlp表示；由于导入语料的时候spacy已经完成分词功能直接调用；在分句时候需要加上’.sents’即可。'
              '输出结果：')
    # a读进语料，默认已经完成分词存入doc中

    # a分词
    for token in doc:
        print(token)
    print('***************')
    # b分句.sents
    for sent in doc.sents:
        print(sent)


def convertEmf():
    emf_image = Image.open("C:\\Users\\menglb\\Downloads\\1199951e6eaa42bd8e8c4bb1c7821f39.emf")
    emf_image.save("C:\\Users\\menglb\\Downloads\\1199951e6eaa42bd8e8c4bb1c7821f39.png", 'PNG')


def ocr_openai():
    # 打开图像文件并读取其内容
    with open("C:\\Users\\menglb\\Downloads\\embe-ebook-1.png", "rb") as image_file:
        base64_bytes = base64.b64encode(image_file.read())
        # print(base64_bytes)
        # 将 Base64 编码的字节对象转换为字符串
        base64_string = base64_bytes.decode("utf-8")
        print(image_ocr_openai("data:image/jpeg;base64," + base64_string))


def ocr_xin():
    # 打开图像文件并读取其内容
    with open("C:\\Users\\menglb\\Downloads\\embe-ebook-1.png", "rb") as image_file:
        print(image_ocr_xin(image_file.read()))


def pdf_text():
    with open("C:\\Users\\menglb\\Downloads\\image.pdf", "rb") as pdf_file:
        print(get_pdf_text(pdf_file.read(), True))


if __name__ == '__main__':
    pdf_text()
