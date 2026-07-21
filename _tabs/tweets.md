---
layout: page
title: Tweets
icon: fab fa-twitter
order: 3
---

<p>Welcome to my Digital Garden! Here is a collection of living documents, tweets, and notes I iterate on.</p>

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
  {% for tweet in site.tweets %}
    <div class="tweet-card">
      <div class="tweet-content content">
        {{ tweet.content | markdownify }}
      </div>
      <div class="tweet-date">
        {{ tweet.last_modified_at | default: tweet.date | date: "%l:%M %p · %b %d, %Y" | default: "Recently" }}
      </div>
    </div>
  {% endfor %}
</div>
