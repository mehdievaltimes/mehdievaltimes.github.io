---
layout: page
title: Tips
icon: fas fa-lightbulb
order: 3
---

<style>
  #mystery-wall {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    z-index: 99999;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .mystery-card {
    background: var(--card-bg, var(--main-bg));
    border: 1px solid var(--border-color);
    padding: 3rem;
    border-radius: 12px;
    text-align: center;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    max-width: 90%;
  }
  #mystery-wall button {
    margin-top: 1.5rem;
    padding: 0.5rem 2rem;
    border: none;
    border-radius: 5px;
    background: var(--link-color);
    color: #fff;
    cursor: pointer;
  }
</style>

<div id="mystery-wall">
  <div class="mystery-card">
    <h2 class="mb-4">Halt! Who goes there?</h2>
    <p>To access the Tips, you must complete this quote:</p>
    <div id="mystery-question-container" style="font-size: 1.2rem; color: var(--text-color); line-height: 2;"></div>
    
    <button onclick="checkMysteryAnswer()">Submit</button>
    <p id="mystery-error" style="color: #e74c3c; display: none; margin-top: 1rem;">Incorrect. Try again.</p>
  </div>
</div>

<div id="mystery-content">
  <p>Welcome to my Digital Garden! Here is a collection of living documents, tips, and notes I iterate on.</p>

  <style>
    .tweet-card {
      background: var(--card-bg, var(--main-bg));
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 1.2rem;
      margin-bottom: 1rem;
      display: flex;
      flex-direction: column;
      color: var(--text-color);
    }
    .tweet-content {
      font-size: 1.05rem;
      line-height: 1.5;
    }
    .tweet-content p {
      margin-bottom: 0.5rem;
    }
    .tweet-date {
      color: var(--text-muted);
      font-size: 0.9rem;
      margin-top: 0.8rem;
    }
  </style>

  <div id="tweet-list" class="flex-grow-1 px-xl-1">
    {% for tip in site.tips %}
      <div class="tweet-card">
        <div class="tweet-content content">
          {{ tip.content }}
        </div>
        <div class="tweet-date">
          {{ tip.last_modified_at | default: tip.date | date: "%l:%M %p · %b %d, %Y" | default: "Recently" }}
        </div>
      </div>
    {% endfor %}
  </div>
</div>

<script>
  const inputHtml = `<input type="text" id="mystery-answer" style="width: 100px; display: inline-block; text-align: center; border-bottom: 2px solid var(--text-color); border-top: none; border-left: none; border-right: none; background: transparent; color: var(--text-color); outline: none; padding: 0; font-size: inherit; font-weight: bold;" onkeypress="if(event.key === 'Enter') checkMysteryAnswer()">`;

  const riddles = [
    { q: `"Don't make me a ${inputHtml}. You will ruin my life." (Fleabag)`, a: "optimist" },
    { q: `"There is no ${inputHtml}." (The Matrix)`, a: "spoon" },
    { q: `"I am the one who ${inputHtml}!" (Breaking Bad)`, a: "knocks" },
    { q: `"May the ${inputHtml} be with you." (Star Wars)`, a: "force" },
    { q: `"I'm going to make him an ${inputHtml} he can't refuse." (The Godfather)`, a: "offer" }
  ];
  
  let currentRiddle = riddles[Math.floor(Math.random() * riddles.length)];
  
  document.getElementById('mystery-question-container').innerHTML = currentRiddle.q;
  
  setTimeout(() => {
    const input = document.getElementById('mystery-answer');
    if (input) input.focus();
  }, 100);
  
  if (sessionStorage.getItem('passedMysteryWall') === 'true') {
    document.getElementById('mystery-wall').style.display = 'none';
    document.getElementById('mystery-content').style.display = 'block';
  }
  
  function checkMysteryAnswer() {
    const inputField = document.getElementById('mystery-answer');
    if (!inputField) return;
    
    const input = inputField.value.trim().toLowerCase();
    if (input === currentRiddle.a.toLowerCase()) {
      sessionStorage.setItem('passedMysteryWall', 'true');
      document.getElementById('mystery-wall').style.display = 'none';
      document.getElementById('mystery-content').style.display = 'block';
    } else {
      document.getElementById('mystery-error').style.display = 'block';
      setTimeout(() => {
        document.getElementById('mystery-error').style.display = 'none';
      }, 3000);
    }
  }
</script>
