---
layout: page
title: Guides
icon: fas fa-book
order: 3
---

<style>
  #mystery-wall {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: var(--main-bg);
    z-index: 99999;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 2rem;
  }
  #mystery-wall input {
    margin-top: 1rem;
    padding: 0.5rem 1rem;
    border: 1px solid var(--border-color);
    border-radius: 5px;
    background: var(--main-bg);
    color: var(--text-color);
    width: 300px;
    max-width: 100%;
  }
  #mystery-wall button {
    margin-top: 1rem;
    padding: 0.5rem 2rem;
    border: none;
    border-radius: 5px;
    background: var(--link-color);
    color: #fff;
    cursor: pointer;
  }
  #mystery-content {
    display: none;
  }
</style>

<div id="mystery-wall">
  <h2 class="mb-4">Halt! Who goes there?</h2>
  <p>To access the Guides, you must answer this question:</p>
  <strong id="mystery-question" style="font-size: 1.2rem; color: var(--text-color);"></strong>
  <br>
  <input type="text" id="mystery-answer" placeholder="Your answer..." onkeypress="if(event.key === 'Enter') checkMysteryAnswer()">
  <br>
  <button onclick="checkMysteryAnswer()">Submit</button>
  <p id="mystery-error" style="color: #e74c3c; display: none; margin-top: 1rem;">Incorrect. Try again.</p>
</div>

<div id="mystery-content">
  <p>Welcome to my Digital Garden! Here is a collection of living documents, guides, and notes I iterate on.</p>

  <div id="post-list" class="flex-grow-1 px-xl-1">
    {% for guide in site.guides %}
      <article class="card-wrapper card">
        <a href="{{ guide.url | relative_url }}" class="post-preview row g-0 flex-md-row">
          <div class="col-md-12">
            <div class="card-body d-flex flex-column">
              <h1 class="card-title my-2 mt-md-0">{{ guide.title }}</h1>
              <div class="card-text content mt-0 mb-3">
                <p>{{ guide.content | strip_html | truncatewords: 30 | escape }}</p>
              </div>
              <div class="post-meta flex-grow-1 d-flex align-items-end">
                <div class="me-auto">
                  <i class="far fa-calendar fa-fw me-1"></i>
                  <em>{{ guide.last_modified_at | default: guide.date | default: "Recently Updated" }}</em>
                </div>
              </div>
            </div>
          </div>
        </a>
      </article>
    {% endfor %}
  </div>
</div>

<script>
  const riddles = [
    { q: '"Don\'t make me a ____. You will ruin my life." (Fleabag)', a: "optimist" },
    { q: '"There is no ____." (The Matrix)', a: "spoon" },
    { q: '"I am the one who ____!" (Breaking Bad)', a: "knocks" },
    { q: '"May the ____ be with you." (Star Wars)', a: "force" },
    { q: '"I\'m going to make him an ____ he can\'t refuse." (The Godfather)', a: "offer" }
  ];
  
  let currentRiddle = riddles[Math.floor(Math.random() * riddles.length)];
  
  document.getElementById('mystery-question').innerText = currentRiddle.q;
  
  if (sessionStorage.getItem('passedMysteryWall') === 'true') {
    document.getElementById('mystery-wall').style.display = 'none';
    document.getElementById('mystery-content').style.display = 'block';
  }
  
  function checkMysteryAnswer() {
    const input = document.getElementById('mystery-answer').value.trim().toLowerCase();
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
