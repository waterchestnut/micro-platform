/**
 * 调用 Dify 工作流 API
 * @param {Object} inputs - 工作流输入参数
 * @param {string} user - 用户标识
 * @param {string} apiKey - Dify API 密钥
 * @param {string} baseUrl - Dify API 基础 URL
 * @param {string} responseMode - 响应模式 ('blocking' 或 'streaming')
 * @param {number} timeout - 超时时间（毫秒），默认 120000ms (2分钟)
 * @param {Function} streamCallback - 流式传输回调函数（仅在 streaming 模式下使用）
 * @returns {Promise<Object|Response>} 响应数据或流
 */
export async function runWorkflow(
    inputs,
    user,
    apiKey,
    baseUrl,
    responseMode = 'blocking',
    timeout = 24000000, // 新增：默认 4 分钟超时
    streamCallback = null // 新增：流式传输回调函数
) {
    if (!inputs || !user || !apiKey || !baseUrl) {
        throw new Error('Inputs, user, apiKey, and baseUrl are required parameters.');
    }

    const requestBody = {
        inputs: inputs,
        response_mode: responseMode,
        user: user,
    };

    console.log('Request Body:', requestBody);

    const url = `${baseUrl}/v1/workflows/run`;

    // 使用 AbortController 控制超时
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal, // 绑定中断信号
        });
        clearTimeout(timeoutId); // 清除定时器
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
        }
        if (responseMode === 'streaming') {
            console.log('Streaming response initiated.');
            console.log(response);
            
            // 如果提供了回调函数，则处理流式数据
            if (streamCallback && typeof streamCallback === 'function') {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let shouldSendThink = true; // 控制是否继续发送think内容
                let buffer = ''; // 用于缓存不完整的数据块
                
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        
                        const chunk = decoder.decode(value, { stream: true });
                        buffer += chunk; // 将新数据添加到缓冲区
                        
                        // 处理 SSE 格式的数据
                        const lines = buffer.split('\n');
                        
                        // 保留最后一行（可能不完整），其余行进行处理
                        buffer = lines.pop() || '';
                        
                        for (const line of lines) {
                            if (line.trim() === '') continue;
                            if (line.startsWith('data: ')) {
                                const data = line.slice(6).trim();
                                if (data === '[DONE]') {
                                    console.log('Stream completed');
                                    break;
                                }
                                
                                // 尝试解析JSON，如果失败则跳过这一行
                                try {
                                    const jsonData = JSON.parse(data);
                                    
                                    // 处理 text_chunk 事件
                                    if (jsonData.event === 'text_chunk' && jsonData.data && jsonData.data.text) {
                                        const text = jsonData.data.text;
                                        
                                        // 检查是否包含 </think>，如果包含则停止发送think内容
                                        if (text.includes('</think>')) {
                                            shouldSendThink = false;
                                            console.log('检测到 </think>，停止发送think内容');
                                            streamCallback('think', text);
                                        }
                                        
                                        // 只有在shouldSendThink为true时才发送think内容
                                        if (shouldSendThink) {
                                            streamCallback('think', text);
                                        }
                                    }
                                    // 处理 workflow_finished 事件
                                    else if (jsonData.event === 'workflow_finished' && jsonData.data && jsonData.data.outputs && jsonData.data.outputs.text) {
                                        console.log('工作流完成，发送最终结果');
                                        streamCallback('result', jsonData.data.outputs.text);
                                    } else {
                                        console.log('其他事件类型:', jsonData.event);
                                    }
                                } catch (parseError) {
                                    // JSON解析失败，记录但不中断流程
                                    console.warn('JSON解析失败，跳过此行:', data.substring(0, 100) + (data.length > 100 ? '...' : ''));
                                }
                            }
                        }
                    }
                    
                    // 处理缓冲区中剩余的数据
                    if (buffer.trim() && buffer.startsWith('data: ')) {
                        const data = buffer.slice(6).trim();
                        if (data && data !== '[DONE]') {
                            try {
                                const jsonData = JSON.parse(data);
                                if (jsonData.event === 'workflow_finished' && jsonData.data && jsonData.data.outputs && jsonData.data.outputs.text) {
                                    console.log('处理缓冲区中的最终结果');
                                    streamCallback('result', jsonData.data.outputs.text);
                                }
                            } catch (parseError) {
                                console.warn('处理缓冲区剩余数据时JSON解析失败:', data.substring(0, 100) + (data.length > 100 ? '...' : ''));
                            }
                        }
                    }
                } finally {
                    reader.releaseLock();
                }
                return { success: true, message: 'Stream completed' };
            } else {
                return response; // 返回 ReadableStream，由调用方处理
            }
        } else {
            const data = await response.json();
            return data;
        }
    } catch (error) {
        clearTimeout(timeoutId);

        if (error.name === 'AbortError') {
            console.error('Request timed out:', url);
            throw new Error(`Request to Dify timed out after ${timeout}ms`);
        }

        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            console.error('Network error or unable to reach Dify API:', error.message);
            throw new Error('Network error: Unable to connect to Dify API. Check URL, network, or if the service is running.');
        }

        console.error('Error running workflow:', error);
        throw error;
    }
}

// --- 如何使用 ---
// 请替换以下占位符为你自己的值
const YOUR_API_KEY = '{app-RuzDCM5raydVvQ0T3LngYzLQ}';
const YOUR_BASE_URL = 'http://192.168.31.5';
const YOUR_USER_ID = 'user-123';

// 根据你的需求定义输入变量
const workflowInputs = {
    question: '请帮我总结一下这个文件的核心内容。',
    question_type: 1
};

/*


// 调用函数来运行工作流
// 流式模式
runWorkflow(workflowInputs, YOUR_USER_ID, YOUR_API_KEY, YOUR_BASE_URL, 'streaming')
    .then(response => {
        // 假设是流式模式，你可以在这里处理 response.body
        console.log('Streaming response body is ready to be consumed.');
    })
    .catch(error => {
        console.error('An error occurred:', error);
    });

// 阻塞模式
runWorkflow(workflowInputs, YOUR_USER_ID, YOUR_API_KEY, YOUR_BASE_URL, 'blocking')
    .then(data => {
        if (data) {
            console.log('Successfully received data in blocking mode:', data);
        }
    })
    .catch(error => {
        console.error('An error occurred:', error);
    });
 */