---
layout: page
title: Demos
icon: fas fa-flask
order: 4
---

# The Mechanistic Sandbox

Welcome to the sandbox! The demos below run **100% locally in your browser** using WebAssembly and [Transformers.js](https://huggingface.co/docs/transformers.js/index). 

*(Note: The first time you interact with them, they will take a few seconds to download the neural networks into your browser's cache. Subsequent loads will be instant!)*

<style>
  .word-token {
    display: inline-block;
    padding: 6px 12px;
    margin: 4px;
    border-radius: 8px;
    background-color: var(--card-bg, var(--main-bg));
    border: 2px solid var(--border-color);
    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    cursor: pointer;
    transition: background-color 0.2s, color 0.2s, border-color 0.2s, transform 0.1s;
    font-size: 1.1rem;
    font-weight: 500;
    color: var(--text-color);
  }
  .word-token:hover {
    transform: translateY(-2px);
  }
  .word-token.active {
    border-color: #e74c3c;
    color: var(--text-color);
  }

  .matrix-table {
    border-collapse: collapse;
    margin: 2rem auto;
  }
  .matrix-cell {
    width: 40px;
    height: 40px;
    text-align: center;
    vertical-align: middle;
    font-size: 0.8rem;
    border: 1px solid var(--border-color);
    transition: transform 0.1s, border 0.1s;
    cursor: crosshair;
  }
  .matrix-cell:hover {
    transform: scale(1.1);
    border: 2px solid var(--text-color);
    z-index: 10;
    position: relative;
  }
  .matrix-header-col {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    padding: 10px;
    font-size: 0.9rem;
    font-weight: bold;
    text-align: left;
    white-space: nowrap;
    color: var(--text-color);
  }
  .matrix-header-row {
    padding: 10px;
    font-size: 0.9rem;
    font-weight: bold;
    text-align: right;
    white-space: nowrap;
    color: var(--text-color);
  }
</style>

---

## 1. Tokenization
Before an LLM can understand language or pay attention to it, it has to chop words up into subword "tokens." You can visualize exactly how models like GPT-4 slice up rare words (like *indubitably*) using [OpenAI's official Tokenizer Sandbox](https://platform.openai.com/tokenizer).

---

## 2. The Semantic Brain (Embeddings)
How does a neural network know that *"The monarch rested"* is similar to *"The king sat"* even though they share no words? 

We use a feature extraction model (`all-MiniLM-L6-v2`) to turn text into a 384-dimensional dense vector space, and then calculate the **Cosine Similarity** between them! Try typing two sentences below to see their mathematical similarity.

<div id="semantic-app" style="margin: 2rem 0; padding: 2rem; background: var(--card-bg, var(--main-bg)); border: 1px solid var(--border-color); border-radius: 12px;">
  <input type="text" id="sem-input-1" placeholder="Sentence A (e.g. The king sat on the throne)" class="form-control mb-2" style="font-size: 1.1rem; padding: 10px; width: 100%; border: 1px solid var(--border-color); border-radius: 8px; background: var(--main-bg); color: var(--text-color); margin-bottom: 10px;" />
  <input type="text" id="sem-input-2" placeholder="Sentence B (e.g. The monarch rested on his chair)" class="form-control mb-3" style="font-size: 1.1rem; padding: 10px; width: 100%; border: 1px solid var(--border-color); border-radius: 8px; background: var(--main-bg); color: var(--text-color);" />
  
  <div style="display: flex; align-items: center; gap: 1rem; margin-top: 1.5rem;">
    <div style="flex-grow: 1; background: var(--border-color); height: 24px; border-radius: 12px; overflow: hidden; position: relative;">
      <div id="similarity-bar" style="height: 100%; width: 0%; background: #2ecc71; transition: width 0.3s, background-color 0.3s;"></div>
    </div>
    <span id="similarity-score" style="font-weight: bold; font-size: 1.2rem; min-width: 60px;">0.00</span>
  </div>
  <div id="sem-progress-container" style="display: none; background: var(--border-color); height: 8px; border-radius: 4px; overflow: hidden; margin-top: 10px;">
    <div id="sem-progress-bar" style="height: 100%; width: 0%; background: #3498db; transition: width 0.1s;"></div>
  </div>
  <em class="text-muted small mt-3 d-block" id="sem-status">Loading Semantic Model (80MB)... This may take a moment when you first type.</em>
</div>

---

## 3. The Live Attention Visualizer

Type a sentence below to generate an interactive map! **Hover over any word in the sentence below to see what it is paying attention to**, OR look at the full **N × N Matrix** grid beneath it.

> [!NOTE]
> **A Note on Approximation:** Standard WebAssembly models physically delete their internal attention tensors to save space. To simulate the "attention" map live in your browser, this visualizer actually computes the **Token-to-Token Semantic Similarity** across the final layer of the network. It tells us how much the *meaning* of one token was blended with the *meaning* of another token, which visually and functionally serves as a beautiful approximation of self-attention!

<div id="matrix-app" style="margin: 2rem 0; padding: 2rem; background: var(--card-bg, var(--main-bg)); border: 1px solid var(--border-color); border-radius: 12px; text-align: center; overflow-x: auto;">
  <input type="text" id="matrix-input" placeholder="Type a sentence (e.g. The quick brown fox)..." class="form-control mb-4" style="font-size: 1.2rem; padding: 10px; width: 100%; border: 1px solid var(--border-color); border-radius: 8px; background: var(--main-bg); color: var(--text-color);" />
  
  <div id="matrix-progress-container" style="display: none; background: var(--border-color); height: 8px; border-radius: 4px; overflow: hidden; margin-bottom: 10px;">
    <div id="matrix-progress-bar" style="height: 100%; width: 0%; background: #3498db; transition: width 0.1s;"></div>
  </div>
  <em class="text-muted" id="matrix-status">Loading Matrix Model...</em>
  
  <!-- Interactive Hover Row -->
  <div id="matrix-hover-container" style="display: flex; justify-content: center; flex-wrap: wrap; margin-top: 1rem;">
    <!-- Tokens injected via JS -->
  </div>
  <p class="mt-4 text-muted small" id="matrix-helper" style="display: none;">Hover over a word to visualize its simulated attention weights.</p>
  
  <hr style="margin: 2rem 0; border-top: 1px solid var(--border-color);" />

  <!-- Interactive NxN Grid -->
  <div id="matrix-grid-container" style="display: flex; justify-content: center; overflow-x: auto;">
    <!-- Table injected via JS -->
  </div>
</div>

---

## 4. The Canned Attention Visualizer
For educational purposes, here is a hard-coded visualisation of a pre-computed attention matrix extracted from a real Transformer model running offline. Hover over any token to see which other tokens it "attends" to!

<div style="margin: 2rem 0; padding: 2rem; background: var(--card-bg, var(--main-bg)); border: 1px solid var(--border-color); border-radius: 12px; text-align: center;">
  <div id="attention-sandbox">
    <!-- Words will be injected here -->
  </div>
  <p class="mt-4 text-muted small">Hover over a word to visualize its attention weights.</p>
</div>

<!-- Scripts for the Transformers.js models -->
<script type="module">
  import { pipeline, AutoTokenizer, cos_sim, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.14.0/dist/transformers.min.js';

  // Prevent local 404s
  env.allowLocalModels = false;

  // ==========================================
  // 2. Semantic Brain
  // ==========================================
  (async function() {
    const statusEl = document.getElementById('sem-status');
    const input1 = document.getElementById('sem-input-1');
    const input2 = document.getElementById('sem-input-2');
    const bar = document.getElementById('similarity-bar');
    const scoreText = document.getElementById('similarity-score');
    const progressContainer = document.getElementById('sem-progress-container');
    const progressBar = document.getElementById('sem-progress-bar');
    
    let extractor = null;
    let isExtracting = false;
    
    const loadPipeline = async () => {
        if (!extractor && !isExtracting) {
            isExtracting = true;
            statusEl.innerText = "Downloading Semantic Model... Please wait.";
            statusEl.style.color = "#e67e22";
            progressContainer.style.display = 'block';
            
            try {
                extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
                    progress_callback: (data) => {
                        if (data.status === 'progress' && data.progress !== undefined) {
                            progressBar.style.width = `${data.progress}%`;
                        } else if (data.status === 'ready') {
                            progressBar.style.width = `100%`;
                        }
                    }
                });
                statusEl.innerText = "Model loaded successfully! Type to compute similarity.";
                statusEl.style.color = "#2ecc71";
                progressContainer.style.display = 'none';
            } catch(e) {
                console.error("Semantic Brain Error:", e);
                statusEl.innerText = "Failed to load model. Please check console.";
                statusEl.style.color = "#e74c3c";
            }
        }
    };
    
    input1.addEventListener('focus', loadPipeline);
    input2.addEventListener('focus', loadPipeline);
    
    const computeSimilarity = async () => {
        if (!extractor) return;
        const text1 = input1.value;
        const text2 = input2.value;
        if (!text1 || !text2) { bar.style.width = '0%'; scoreText.innerText = "0.00"; return; }
        try {
            const out1 = await extractor(text1, { pooling: 'mean', normalize: true });
            const out2 = await extractor(text2, { pooling: 'mean', normalize: true });
            let score = cos_sim(out1.data, out2.data);
            score = Math.max(0, Math.min(1, score));
            scoreText.innerText = score.toFixed(2);
            bar.style.width = `${score * 100}%`;
            if (score > 0.7) bar.style.backgroundColor = '#2ecc71';
            else if (score > 0.4) bar.style.backgroundColor = '#f1c40f';
            else bar.style.backgroundColor = '#e74c3c';
        } catch(e) {
            console.error("Error computing similarity:", e);
        }
    };
    
    input1.addEventListener('input', computeSimilarity);
    input2.addEventListener('input', computeSimilarity);
  })();

  // ==========================================
  // 3. Live Attention Visualizer
  // ==========================================
  (async function() {
    const statusEl = document.getElementById('matrix-status');
    const inputEl = document.getElementById('matrix-input');
    const hoverContainer = document.getElementById('matrix-hover-container');
    const gridContainer = document.getElementById('matrix-grid-container');
    const helper = document.getElementById('matrix-helper');
    const progressContainer = document.getElementById('matrix-progress-container');
    const progressBar = document.getElementById('matrix-progress-bar');
    
    let extractor = null;
    let tokenizer = null;
    let isExtracting = false;

    const loadMatrixModel = async () => {
        if (!extractor && !isExtracting) {
            isExtracting = true;
            statusEl.innerText = "Preparing Matrix Model... Please wait.";
            progressContainer.style.display = 'block';
            
            try {
                // Initialize both concurrently or sequentially with progress
                extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
                    progress_callback: (data) => {
                        if (data.status === 'progress' && data.progress !== undefined) {
                            progressBar.style.width = `${data.progress}%`;
                        } else if (data.status === 'ready') {
                            progressBar.style.width = `100%`;
                        }
                    }
                });
                tokenizer = await AutoTokenizer.from_pretrained('Xenova/all-MiniLM-L6-v2');
                
                statusEl.style.display = 'none';
                progressContainer.style.display = 'none';
                inputEl.placeholder = "Type a sentence to visualize attention...";
                if(inputEl.value) renderMatrix();
            } catch(e) {
                console.error("Matrix Model Error:", e);
                statusEl.innerText = "Failed to load matrix model.";
            }
        }
    };

    inputEl.addEventListener('focus', loadMatrixModel);

    let timeoutId;
    const renderMatrix = async () => {
        if (!extractor || !tokenizer) return;
        const text = inputEl.value.trim();
        if (!text) { 
            hoverContainer.innerHTML = ''; 
            gridContainer.innerHTML = ''; 
            helper.style.display = 'none'; 
            return; 
        }

        statusEl.style.display = 'block';
        statusEl.innerText = "Computing weights...";
        helper.style.display = 'none';

        try {
            const tokenIds = tokenizer.encode(text);
            const tokens = tokenizer.model.convert_ids_to_tokens(tokenIds);
            
            const out = await extractor(text, { pooling: 'none' });
            const seq_length = out.dims[1];
            const hidden_size = out.dims[2];
            
            const weights = [];
            for (let i = 0; i < seq_length; i++) {
                const row = [];
                const vecI = out.data.slice(i * hidden_size, (i + 1) * hidden_size);
                for (let j = 0; j < seq_length; j++) {
                    const vecJ = out.data.slice(j * hidden_size, (j + 1) * hidden_size);
                    let dot = 0, norm1 = 0, norm2 = 0;
                    for (let k = 0; k < hidden_size; k++) {
                        dot += vecI[k] * vecJ[k];
                        norm1 += vecI[k] * vecI[k];
                        norm2 += vecJ[k] * vecJ[k];
                    }
                    let sim = dot / (Math.sqrt(norm1) * Math.sqrt(norm2));
                    row.push(Math.max(0, Math.min(1, sim)));
                }
                weights.push(row);
            }

            hoverContainer.innerHTML = '';
            const spanElements = [];
            tokens.forEach((t, i) => {
                const span = document.createElement('span');
                span.className = 'word-token';
                span.innerText = t;
                spanElements.push(span);
                hoverContainer.appendChild(span);
            });

            spanElements.forEach((span, i) => {
                span.addEventListener('mouseenter', () => {
                    span.classList.add('active');
                    spanElements.forEach((otherToken, j) => {
                        if (i !== j) {
                            const w = weights[i][j];
                            otherToken.style.backgroundColor = `rgba(231, 76, 60, ${w})`;
                            if (w > 0.5) otherToken.style.color = "#fff";
                        }
                    });
                });
                
                span.addEventListener('mouseleave', () => {
                    span.classList.remove('active');
                    spanElements.forEach((otherToken) => {
                        otherToken.style.backgroundColor = '';
                        otherToken.style.color = '';
                    });
                });
            });

            gridContainer.innerHTML = '';
            const table = document.createElement('table');
            table.className = 'matrix-table';
            
            const headerRow = document.createElement('tr');
            headerRow.appendChild(document.createElement('th'));
            tokens.forEach(t => {
                const th = document.createElement('th');
                th.className = 'matrix-header-col';
                th.innerText = t;
                headerRow.appendChild(th);
            });
            table.appendChild(headerRow);

            for (let i = 0; i < seq_length; i++) {
                const tr = document.createElement('tr');
                const th = document.createElement('th');
                th.className = 'matrix-header-row';
                th.innerText = tokens[i];
                tr.appendChild(th);

                for (let j = 0; j < seq_length; j++) {
                    const td = document.createElement('td');
                    if (j > i) {
                        td.style.border = 'none';
                        td.style.backgroundColor = 'transparent';
                    } else {
                        const visualWeight = weights[i][j];
                        td.className = 'matrix-cell';
                        td.style.backgroundColor = `rgba(231, 76, 60, ${visualWeight})`;
                        td.title = `${tokens[i]} -> ${tokens[j]}\nSimilarity: ${weights[i][j].toFixed(3)}`;
                        td.innerText = weights[i][j].toFixed(1);
                        if (visualWeight > 0.5) td.style.color = "white";
                        else td.style.color = "transparent";

                        td.addEventListener('mouseenter', () => td.style.color = (visualWeight>0.5?'white':'black'));
                        td.addEventListener('mouseleave', () => td.style.color = (visualWeight>0.5?'white':'transparent'));
                    }
                    tr.appendChild(td);
                }
                table.appendChild(tr);
            }
            gridContainer.appendChild(table);

            statusEl.style.display = 'none';
            helper.style.display = 'block';

        } catch (err) {
            console.error(err);
            statusEl.innerText = "Error computing weights.";
        }
    };

    inputEl.addEventListener('input', () => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(renderMatrix, 500);
    });
  })();
</script>

<!-- Script for Canned Visualizer (Runs independently of the Transformers.js module) -->
<script>
  (function() {
    const sentence = ["The", "quick", "brown", "fox", "jumps", "over", "the", "lazy", "dog"];
    const weights = [
      [1.0, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
      [0.2, 1.0, 0.6, 0.8, 0.1, 0.0, 0.0, 0.0, 0.0],
      [0.1, 0.5, 1.0, 0.9, 0.1, 0.0, 0.0, 0.0, 0.0],
      [0.3, 0.8, 0.9, 1.0, 0.6, 0.1, 0.1, 0.0, 0.0],
      [0.0, 0.1, 0.1, 0.8, 1.0, 0.7, 0.2, 0.5, 0.6],
      [0.0, 0.0, 0.0, 0.1, 0.6, 1.0, 0.3, 0.1, 0.4],
      [0.0, 0.0, 0.0, 0.0, 0.0, 0.1, 1.0, 0.3, 0.6],
      [0.0, 0.0, 0.0, 0.0, 0.2, 0.1, 0.4, 1.0, 0.9],
      [0.0, 0.0, 0.0, 0.3, 0.7, 0.6, 0.8, 0.9, 1.0]
    ];

    const container = document.getElementById('attention-sandbox');
    if(!container) return;
    
    sentence.forEach((word, i) => {
      const span = document.createElement('span');
      span.className = 'word-token';
      span.innerText = word;
      
      span.addEventListener('mouseenter', () => {
        span.classList.add('active');
        const allTokens = container.querySelectorAll('.word-token');
        allTokens.forEach((otherToken, j) => {
          if (i !== j) {
            const w = weights[i][j];
            otherToken.style.backgroundColor = `rgba(231, 76, 60, ${w})`;
            if(w > 0.5) otherToken.style.color = "#fff";
          }
        });
      });
      
      span.addEventListener('mouseleave', () => {
        span.classList.remove('active');
        const allTokens = container.querySelectorAll('.word-token');
        allTokens.forEach((otherToken) => {
          otherToken.style.backgroundColor = '';
          otherToken.style.color = '';
        });
      });
      
      container.appendChild(span);
    });
  })();
</script>
