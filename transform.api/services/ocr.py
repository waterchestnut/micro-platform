import os
import base64
from openai import OpenAI
from configs import openai_ocr_base_url, openai_ocr_api_key, openai_ocr_model, xinference_base_url, xinference_ocr_model
from xinference_client import RESTfulClient


def image_ocr_openai(image_url):
    client = OpenAI(base_url=openai_ocr_base_url, api_key=openai_ocr_api_key, timeout=3600)

    messages = [
        {"role": "system", "content": ""},
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {
                        "url": image_url
                    }
                },
                {
                    "type": "text",
                    "text": " 提取图中的文字"
                }
            ]
        }
    ]

    response = client.chat.completions.create(
        model=openai_ocr_model,
        messages=messages,
        temperature=0.0,
        extra_body={
            "top_k": 1,
            "repetition_penalty": 1.0
        },
    )
    return response.choices[0].message.content


def image_ocr_xin(image_data):
    client = RESTfulClient(xinference_base_url)

    model = client.get_model(xinference_ocr_model)
    return model.ocr(image_data, prompt='提取图中的文字，保留换行符').replace('以下是图片中的文字内容。\n', '')


def _to_data_url(image_data):
    """bytes -> data URL（供中转站多模态识别；按文件头猜 mime）"""
    head = bytes(image_data[:12])
    if head[:8] == b'\x89PNG\r\n\x1a\n':
        mime = 'image/png'
    elif head[:3] == b'\xff\xd8\xff':
        mime = 'image/jpeg'
    elif head[:6] in (b'GIF87a', b'GIF89a'):
        mime = 'image/gif'
    elif head[:4] == b'RIFF' and image_data[8:12] == b'WEBP':
        mime = 'image/webp'
    elif head[:2] == b'BM':
        mime = 'image/bmp'
    else:
        mime = 'image/png'
    return 'data:%s;base64,%s' % (mime, base64.b64encode(image_data).decode())


def image_ocr_auto(image_data):
    """OCR 统一入口：优先 xinference 专用 OCR 模型，模型缺失/异常时回退中转站多模态（OPENAI_OCR_*）"""
    try:
        text = image_ocr_xin(image_data)
        if text and str(text).strip():
            return text
    except Exception:
        pass
    return image_ocr_openai(_to_data_url(image_data))
