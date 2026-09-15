import { pipeline, AutoTokenizer, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js';

// Prevent local 404s
env.allowLocalModels = false;
env.useBrowserCache = true;

// Explicitly set the WASM path to the CDN to prevent 404s on GitHub Pages
env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/';

const logToUI = () => {};

function cos_sim(arr1, arr2) {
    let dot = 0, norm1 = 0, norm2 = 0;
    for (let i = 0; i < arr1.length; i++) {
        dot += arr1[i] * arr2[i];
        norm1 += arr1[i] * arr1[i];
        norm2 += arr2[i] * arr2[i];
    }
    return dot / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

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
          progressContainer.style.display = 'block';
          
          try {
              logToUI("Starting Semantic Brain pipeline download...");
              extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
                  progress_callback: (data) => {
                      logToUI(`Semantic Brain [${data.status}]: ${data.file || ''} - ${data.progress ? data.progress.toFixed(1) + '%' : ''}`);
                      if (data.status === 'progress' && data.progress !== undefined) {
                          progressBar.style.width = `${data.progress}%`;
                      } else if (data.status === 'ready') {
                          progressBar.style.width = `100%`;
                      }
                  }
              });
              logToUI("Semantic Brain pipeline loaded successfully.");
              statusEl.innerText = "Model loaded successfully! Type to compute similarity.";
              progressContainer.style.display = 'none';
              if(input1.value && input2.value) computeSimilarity();
          } catch(e) {
              logToUI(`Semantic Brain Error: ${e.message || e}`);
              console.error("Semantic Model Error:", e);
              statusEl.innerText = "Failed to load model. Please check console.";
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
          bar.style.opacity = String(0.35 + score * 0.65);
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
              logToUI("Starting Matrix Model pipeline download...");
              // Initialize both concurrently or sequentially with progress
              extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
                  progress_callback: (data) => {
                      logToUI(`Matrix Model [${data.status}]: ${data.file || ''} - ${data.progress ? data.progress.toFixed(1) + '%' : ''}`);
                      if (data.status === 'progress' && data.progress !== undefined) {
                          progressBar.style.width = `${data.progress}%`;
                      } else if (data.status === 'ready') {
                          progressBar.style.width = `100%`;
                      }
                  }
              });
              
              logToUI("Starting Matrix tokenizer download...");
              tokenizer = await AutoTokenizer.from_pretrained('Xenova/all-MiniLM-L6-v2');
              logToUI("Matrix Model & Tokenizer loaded successfully.");
              
              statusEl.style.display = 'none';
              progressContainer.style.display = 'none';
              inputEl.placeholder = "Type a sentence to visualize attention...";
              if(inputEl.value) renderMatrix();
          } catch(e) {
              logToUI(`Matrix Model Error: ${e.message || e}`);
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
                          otherToken.style.backgroundColor = `rgb(var(--accent-rgb) / ${w})`;
                          if (w > 0.5) otherToken.style.color = "var(--bg)";
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
                      td.style.backgroundColor = `rgb(var(--accent-rgb) / ${visualWeight})`;
                      td.title = `${tokens[i]} -> ${tokens[j]}\nSimilarity: ${weights[i][j].toFixed(3)}`;
                      td.innerText = weights[i][j].toFixed(1);
                      if (visualWeight > 0.5) td.style.color = "var(--bg)";
                      else td.style.color = "transparent";

                      td.addEventListener('mouseenter', () => td.style.color = (visualWeight>0.5?'var(--bg)':'var(--fg)'));
                      td.addEventListener('mouseleave', () => td.style.color = (visualWeight>0.5?'var(--bg)':'transparent'));
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
