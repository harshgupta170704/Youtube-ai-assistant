<div align="center">
  <img src="icons/icon128.png" alt="YouTube AI Assistant Logo" width="100"/>
  <h1>YouTube AI Assistant</h1>
  <p><strong>Context-Aware YouTube AI Assistant featuring Multi-Model Fallback</strong></p>

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
  [![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen.svg)](https://developer.chrome.com/docs/extensions/mv3/)

</div>

---

<details open>
  <summary><strong>📖 Table of Contents</strong></summary>
  <br>

- [✨ Features and Capabilities](#-features-and-capabilities)
- [📸 Screenshots & Demos](#-screenshots--demos)
- [🚀 Installation & Setup](#-installation--setup)
- [🛠️ Tech Stack](#️-tech-stack)
- [📝 License](#-license)
</details>

---

An advanced, context-aware Chrome Extension that serves as an AI assistant natively injected into YouTube. It intelligently uses the current video's transcript, context, and external web sources to answer questions, explain code, and recommend related videos.

## ✨ Features and Capabilities

- 🧠 **Multi-Model Support with Fallback**: Enter API keys for **Gemini, DeepSeek, and Groq**. Choose a primary model, and the extension will automatically gracefully switch to the others if rate limits or errors are reached.
- 💬 **Context-Aware Chat (RAG)**: Speak directly with the video! The extension creates a Retrieval-Augmented Generation pipeline over the video transcript, allowing you to ask questions about exactly what is being taught.
- 💻 **Code Explanation**: Highlight code within videos and click "Explain" for an instant breakdown of functions, syntax, and logic right inside a draggable panel.
- 🔍 **Intelligent Knowledge Fallback (Wikipedia)**: If a question is outside the scope of the video (e.g. "Who is the Prime Minister of India?"), the assistant will dynamically fetch and parse information from Wikipedia.
- 🎥 **Semantic Video Search**: Perform rich searches (e.g. "Videos related to AI"), and the assistant will surface related actionable video pills and visual thumbnails directly within your chat.
- 🎨 **Modern Draggable & Resizable UI**: A glassmorphic, dark-mode native panel built purely with modern CSS and Vanilla JS. It floats above regular content and can be resized to your preference.

<p align="right"><a href="#top">⬆️ Back to top</a></p>

---

## 📸 Screenshots & Demos

*(Add your images to the `assets/` folder to see them displayed here)*

<details>
  <summary><strong>1. Smart Code Expansion & Explanation</strong> <em>(Click to expand)</em></summary>
  <br>
  <p align="center"><img src="assets/explain-code.png" alt="Explain Code Functionality"></p>
</details>

<details>
  <summary><strong>2. Video Context & Chat Overview</strong> <em>(Click to expand)</em></summary>
  <br>
  <p align="center"><img src="assets/video-overview.png" alt="Chat About Video"></p>
</details>

<details>
  <summary><strong>3. Integrated Wikipedia Search</strong> <em>(Click to expand)</em></summary>
  <br>
  <p align="center"><img src="assets/wikipedia-search.png" alt="Wikipedia Results Viewer"></p>
</details>

<details>
  <summary><strong>4. Smart Video Recommendations</strong> <em>(Click to expand)</em></summary>
  <br>
  <p align="center"><img src="assets/related-videos.png" alt="Semantic Video Search"></p>
</details>

<details>
  <summary><strong>5. Multi-Provider API Configuration</strong> <em>(Click to expand)</em></summary>
  <br>
  <p align="center"><img src="assets/api-keys-panel.png" alt="Settings & API Keys Management"></p>
</details>

<br>
<p align="right"><a href="#top">⬆️ Back to top</a></p>

---

## 🚀 Installation & Setup

1. **Clone or Download** this repository to your local machine.
2. Open Google Chrome and type `chrome://extensions/` into the URL bar.
3. Enable **Developer mode** using the toggle switch in the top right corner.
4. Click on **Load unpacked** and select the `youtube-ai-assistant-v5` directory.

### Configuration

1. Click on the extension's icon (or the gear icon inside the extension panel) to open **Settings**.
2. Put down your respective API keys for **Gemini**, **DeepSeek**, and **Groq**.
3. *Note: You can use any combination. The extension will aggressively default to your chosen primary model but fall back to the others when necessary.*
4. Click **Save Keys**.

<p align="right"><a href="#top">⬆️ Back to top</a></p>

## 🛠️ Tech Stack

- **Vanilla JavaScript**: Pure JS without heavy framework overhead to ensure blazing fast content script execution.
- **Manifest V3 Architecture**: Adheres strictly to the most modern Chrome extension security and service worker paradigms.
- **CSS3 Variables & Glassmorphism**: For smooth animations and dynamic UI resizing.
- **Service Workers API Routing**: Efficiently manages cross-origin fetches for DDG, Wikipedia, and multiple LLM APIs.

---

## 📝 License

Distributed under the MIT License. See `LICENSE` for more information.

<p align="right"><a href="#top">⬆️ Back to top</a></p>
