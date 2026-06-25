const inputHtml = `<input type="text" id="mystery-answer" style="width: 100px; display: inline-block; text-align: center; border-bottom: 2px solid var(--text-color); border-top: none; border-left: none; border-right: none; background: transparent; color: var(--text-color); outline: none; padding: 0; font-size: inherit; font-weight: bold;" onkeypress="if(event.key === 'Enter') checkMysteryAnswer()">`;

  const riddles = [
    { q: `"Don't make me a ${inputHtml}. You will ruin my life." (Fleabag)`, a: "optimist" },
    { q: `"There is no ${inputHtml}." (The Matrix)`, a: "spoon" },
    { q: `"I am the one who ${inputHtml}!" (Breaking Bad)`, a: "knocks" },
    { q: `"May the ${inputHtml} be with you." (Star Wars)`, a: "force" },
    { q: `"I'm going to make him an ${inputHtml} he can't refuse." (The Godfather)`, a: "offer" }
  ];
  console.log(riddles[0].q);
