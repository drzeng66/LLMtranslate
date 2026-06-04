# 本地大模型沉浸式翻译 Chrome 扩展

当前版本：0.2.1

## 新功能

- 支持本机接口：`http://127.0.0.1:8080/v1`
- 支持你的远程 FRP 映射接口：`http://frp4.ccszxc.site:14668/v1`
- 支持整页段落翻译。
- 默认支持 `Ctrl + 鼠标悬停段落` 翻译单段，无需每次手动开启。
- 支持文档翻译页：PDF、DOCX、TXT，并默认生成左原文全文、右译文全文的中英文对照阅读版。
- 文档翻译使用医学文献优化模式：默认 2200 字符大块、4096 输出 token、医学术语保留 prompt，减少碎片化请求。
- 支持清除页面译文。
- 支持调用 llama.cpp `/slots/0?action=erase` 清空模型上下文。
- 支持设置重试次数、超时时间、单段切分长度，降低无效等待。

## 安装 / 更新

1. 打开 Chrome：`chrome://extensions`
2. 开启“开发者模式”
3. 如果已安装旧版，点击扩展卡片上的刷新按钮；如果没有安装，点击“加载已解压的扩展程序”
4. 选择目录：`outputs/local-llm-translator-extension`
5. 打开扩展“选项”，选择接口模式：
   - 本机：`127.0.0.1`
   - 远程 FRP：`frp4.ccszxc.site:14668`

## 推荐 llama-server 启动参数

你当前 Qwen3.6-35B-A3B-MTP 体验好，可以继续用：

```cmd
llama-server.exe -m "C:\Users\zengxiaofeng\llama.cpp\models\gemma.gguf" --host 0.0.0.0 --port 8080 --api-key <你的key> --jinja --reasoning off --reasoning-budget 0 --spec-type draft-mtp --spec-draft-n-max 2 -ngl 99 -c 32768 -b 512 -ub 256 -t 6 -tb 12 -fa on -ctk q8_0 -ctv q8_0 -np 1 --slot-save-path "C:\Users\zengxiaofeng\llama.cpp\slot-cache"
```

`--slot-save-path` 用于启用清空上下文接口。远程访问时请务必保留 API Key，不要裸奔暴露模型服务。

## 使用

### 整页翻译

点击扩展图标 → “翻译 / 暂停当前页面”。译文会插入到原文段落下面。

### Ctrl 悬停翻译

默认已开启。按住 Ctrl，把鼠标移到段落上即可只翻译该段；如果鼠标已经停在段落上，再按 Ctrl 也会触发。弹窗里的“Ctrl + 鼠标悬停默认开启”按钮仅用于页面异常时重新启用。

### 文档翻译

点击扩展图标 → “文档翻译 PDF / Word / TXT”。

- PDF：使用内置 PDF.js 提取文本。扫描件 PDF 需要先 OCR。
- DOCX：支持 Word `.docx`，不支持老式 `.doc`。
- TXT：直接读取。

文档翻译完成后可以下载 `.bilingual.html` 中英文全文对照文件：左栏为原文全文，右栏为译文全文，适合保存、打印或再次打开阅读。

默认“每段最大字符”为 2200，更接近 llama.cpp 网页端拖入 PDF 的大块翻译体验；如显存或上下文压力较大，可降到 1200–1800。

## 安全边界

扩展只允许请求：

- `http://127.0.0.1/*`
- `http://localhost/*`
- `http://frp4.ccszxc.site:14668/*`

不会调用 DeepL、Google、OpenAI 云端接口。
