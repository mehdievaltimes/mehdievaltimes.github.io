---
layout: page
title: Guides
icon: fas fa-book
order: 6
---

Welcome to my Digital Garden! Here is a collection of living documents, guides, and notes I iterate on.

<div class="post-list">
  {% for guide in site.guides %}
  <article class="card-wrapper">
    <a href="{{ guide.url | relative_url }}" class="post-preview">
      <h2 class="post-title">{{ guide.title }}</h2>
      <div class="post-meta">
        <i class="far fa-calendar-alt"></i> {{ guide.last_modified_at | default: guide.date | default: "Recently Updated" | date: "%B %d, %Y" }}
      </div>
    </a>
  </article>
  {% endfor %}
</div>
