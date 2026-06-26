---
layout: page
title: Demos
icon: fas fa-flask
order: 4
---

# The Mechanistic Sandbox

Welcome to the sandbox! The demos below run **100% locally in your browser** using WebAssembly and [Transformers.js](https://huggingface.co/docs/transformers.js/index). 

*(Note: The first time you interact with them, they will take a few seconds to download the neural networks into your browser's cache. Subsequent loads will be instant!)*

---

## 1. The Tokenizer Sandbox
Before an LLM can understand language or pay attention to it, it has to chop words up into subword "tokens." Type any sentence below and watch how the `bert-base-uncased` tokenizer slices your text into pieces in real-time. Notice how rare words (like *indubitably*) are shattered into multiple tokens!

<div id="tokenizer-app" style="margin: 2rem 0; padding: 2rem; background: var(--card-bg, var(--main-bg)); border: 1px solid var(--border-color); border-radius: 12px;">
  <input type="text" id="token-input" placeholder="Type a sentence here..." class="form-control mb-3" style="font-size: 1.2rem; padding: 10px; width: 100%; border: 1px solid var(--border-color); border-radius: 8px; background: var(--main-bg); color: var(--text-color);" />
  <div id="token-output" style="display: flex; flex-wrap: wrap; gap: 8px; min-height: 40px; align-items: center; margin-top: 1rem;">
    <em class="text-muted" id="token-status">Loading Tokenizer...</em>
  </div>
</div>

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
  <em class="text-muted small mt-3 d-block" id="sem-status">Loading Semantic Model (80MB)... This may take a moment when you first type.</em>
</div>

---

## 3. The Live N×N "Attention" Matrix

Type a sentence below to generate a live, interactive `N × N` heatmap!

> [!NOTE]
> **A Note on Approximation:** Standard WebAssembly models physically delete their internal attention tensors to save space. To simulate the "attention" map live in your browser, this visualizer actually computes the **Token-to-Token Semantic Similarity** across the final layer of the network. It tells us how much the *meaning* of one token was blended with the *meaning* of another token, which visually and functionally serves as a beautiful approximation of self-attention!

<style>
  #matrix-app {
    margin: 2rem 0;
    padding: 2rem;
    background: var(--card-bg, var(--main-bg));
    border: 1px solid var(--border-color);
    border-radius: 12px;
    overflow-x: auto;
  }
  .matrix-table {
    border-collapse: collapse;
    margin: 0 auto;
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

<div id="matrix-app">
  <input type="text" id="matrix-input" placeholder="Type a sentence (e.g. The quick brown fox)..." class="form-control mb-4" style="font-size: 1.2rem; padding: 10px; width: 100%; border: 1px solid var(--border-color); border-radius: 8px; background: var(--main-bg); color: var(--text-color);" />
  <em class="text-muted" id="matrix-status">Loading Matrix Model...</em>
  
  <div id="matrix-container" style="display: flex; justify-content: center; margin-top: 1rem;">
    <!-- Table injected via JS -->
  </div>
</div>


<script type="module">
  import { pipeline, AutoTokenizer, cos_sim, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.14.0/dist/transformers.min.js';

  // Prevent local 404s
  env.allowLocalModels = false;

  // ==========================================
  // 1. Tokenizer Sandbox
  // ==========================================
  (async function() {
    const statusEl = document.getElementById('token-status');
    const inputEl = document.getElementById('token-input');
    const outputEl = document.getElementById('token-output');
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FDCB6E', '#6C5CE7', '#55E6C1', '#FDA7DF', '#D980FA'];
    try {
      const tokenizer = await AutoTokenizer.from_pretrained('Xenova/bert-base-uncased');
      statusEl.style.display = 'none';
      inputEl.placeholder = "Type a sentence here (Tokenizer Ready!)...";
      const renderTokens = () => {
        const text = inputEl.value;
        if (!text) { outputEl.innerHTML = ''; return; }
        const ids = tokenizer.encode(text);
        const tokens = tokenizer.model.convert_ids_to_tokens(ids);
        outputEl.innerHTML = '';
        tokens.forEach((t, i) => {
          const badge = document.createElement('span');
          badge.style.padding = '4px 10px';
          badge.style.borderRadius = '6px';
          badge.style.color = '#fff';
          badge.style.fontWeight = 'bold';
          badge.style.fontFamily = 'monospace';
          badge.style.backgroundColor = colors[i % colors.length];
          badge.innerText = t;
          outputEl.appendChild(badge);
        });
      };
      inputEl.addEventListener('input', renderTokens);
      renderTokens();
    } catch (e) {
      statusEl.innerText = "Error loading tokenizer.";
    }
  })();

  // ==========================================
  // 2. Semantic Brain
  // ==========================================
  (async function() {
    const statusEl = document.getElementById('sem-status');
    const input1 = document.getElementById('sem-input-1');
    const input2 = document.getElementById('sem-input-2');
    const bar = document.getElementById('similarity-bar');
    const scoreText = document.getElementById('similarity-score');
    let extractor = null;
    let isExtracting = false;
    const loadPipeline = async () => {
        if (!extractor && !isExtracting) {
            isExtracting = true;
            statusEl.innerText = "Downloading Semantic Model (80MB)... Please wait.";
            statusEl.style.color = "#e67e22";
            try {
                extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
                statusEl.innerText = "Model loaded successfully! Type to compute similarity.";
                statusEl.style.color = "#2ecc71";
            } catch(e) {
                statusEl.innerText = "Failed to load model.";
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
        const out1 = await extractor(text1, { pooling: 'mean', normalize: true });
        const out2 = await extractor(text2, { pooling: 'mean', normalize: true });
        let score = cos_sim(out1.data, out2.data);
        score = Math.max(0, Math.min(1, score));
        scoreText.innerText = score.toFixed(2);
        bar.style.width = `${score * 100}%`;
        if (score > 0.7) bar.style.backgroundColor = '#2ecc71';
        else if (score > 0.4) bar.style.backgroundColor = '#f1c40f';
        else bar.style.backgroundColor = '#e74c3c';
    };
    input1.addEventListener('input', computeSimilarity);
    input2.addEventListener('input', computeSimilarity);
  })();

  // ==========================================
  // 3. Live NxN Matrix
  // ==========================================
  (async function() {
    const statusEl = document.getElementById('matrix-status');
    const inputEl = document.getElementById('matrix-input');
    const container = document.getElementById('matrix-container');
    let extractor = null;
    let tokenizer = null;
    let isExtracting = false;

    const loadMatrixModel = async () => {
        if (!extractor && !isExtracting) {
            isExtracting = true;
            statusEl.innerText = "Preparing Matrix Model (80MB)... Please wait.";
            try {
                extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
                tokenizer = await AutoTokenizer.from_pretrained('Xenova/all-MiniLM-L6-v2');
                statusEl.style.display = 'none';
                inputEl.placeholder = "Type a sentence to build the NxN matrix...";
                // trigger a render if there's text
                if(inputEl.value) renderMatrix();
            } catch(e) {
                statusEl.innerText = "Failed to load matrix model.";
            }
        }
    };

    inputEl.addEventListener('focus', loadMatrixModel);

    // Debounce the matrix rendering so we don't freeze the browser on every keystroke
    let timeoutId;
    const renderMatrix = async () => {
        if (!extractor || !tokenizer) return;
        const text = inputEl.value.trim();
        if (!text) { container.innerHTML = ''; return; }

        statusEl.style.display = 'block';
        statusEl.innerText = "Computing N×N grid...";

        try {
            // Extract tokens
            const tokenIds = tokenizer.encode(text);
            const tokens = tokenizer.model.convert_ids_to_tokens(tokenIds);
            
            // Extract unpooled hidden states
            const out = await extractor(text, { pooling: 'none' });
            
            // out.dims = [batch_size (1), seq_length, hidden_size (384)]
            const seq_length = out.dims[1];
            const hidden_size = out.dims[2];
            
            // Reconstruct the 2D matrix
            const table = document.createElement('table');
            table.className = 'matrix-table';
            
            // Header Row
            const headerRow = document.createElement('tr');
            headerRow.appendChild(document.createElement('th')); // Top-left empty
            tokens.forEach(t => {
                const th = document.createElement('th');
                th.className = 'matrix-header-col';
                th.innerText = t;
                headerRow.appendChild(th);
            });
            table.appendChild(headerRow);

            // Calculate similarity for every token pair
            for (let i = 0; i < seq_length; i++) {
                const tr = document.createElement('tr');
                
                // Row Label
                const th = document.createElement('th');
                th.className = 'matrix-header-row';
                th.innerText = tokens[i];
                tr.appendChild(th);

                // Token I's vector
                const vecI = out.data.slice(i * hidden_size, (i + 1) * hidden_size);
                
                for (let j = 0; j < seq_length; j++) {
                    const vecJ = out.data.slice(j * hidden_size, (j + 1) * hidden_size);
                    
                    // Cosine similarity manually (since cos_sim from xenova is for arrays, this is a Float32Array slice)
                    let dot = 0, norm1 = 0, norm2 = 0;
                    for (let k = 0; k < hidden_size; k++) {
                        dot += vecI[k] * vecJ[k];
                        norm1 += vecI[k] * vecI[k];
                        norm2 += vecJ[k] * vecJ[k];
                    }
                    let sim = dot / (Math.sqrt(norm1) * Math.sqrt(norm2));
                    
                    // The similarity will be between -1 and 1. (usually 0 to 1 in this space)
                    // Clamp for visual mapping
                    let visualWeight = Math.max(0, Math.min(1, sim));
                    
                    const td = document.createElement('td');
                    td.className = 'matrix-cell';
                    // Map to a red heatmap (rgba(231, 76, 60, weight))
                    td.style.backgroundColor = `rgba(231, 76, 60, ${visualWeight})`;
                    td.title = `${tokens[i]} -> ${tokens[j]}\nSimilarity: ${sim.toFixed(3)}`;
                    
                    // Don't show text inside the cell, just the color (like a real heatmap), 
                    // or show the float if it fits. We'll show the float on hover via title, 
                    // but let's put the text in the cell for max coolness if it's large enough.
                    td.innerText = sim.toFixed(1);
                    if (visualWeight > 0.5) td.style.color = "white";
                    else td.style.color = "transparent"; // Hide text unless hovered or strong

                    td.addEventListener('mouseenter', () => td.style.color = (visualWeight>0.5?'white':'black'));
                    td.addEventListener('mouseleave', () => td.style.color = (visualWeight>0.5?'white':'transparent'));

                    tr.appendChild(td);
                }
                table.appendChild(tr);
            }

            container.innerHTML = '';
            container.appendChild(table);
            statusEl.style.display = 'none';

        } catch (err) {
            console.error(err);
            statusEl.innerText = "Error computing matrix.";
        }
    };

    inputEl.addEventListener('input', () => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(renderMatrix, 500); // 500ms debounce
    });
  })();
</script>
