import os
from openai import OpenAI
from configs import openai_ocr_base_url, openai_ocr_api_key, openai_ocr_model, xinference_base_url, xinference_ocr_model
from xinference_client import RESTfulClient, Client


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
