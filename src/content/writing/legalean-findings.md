---
title: "Five Things Formalizing Immigration Law Taught Me About Law"
date: 2026-09-16
tags: [lean, formal-methods, law]
---

I wrote up [how Legalean works](/posts/legalean/) — statutes in, Lean proofs out. This is the other half: what the corpus actually taught me once 24 real provisions were in it. Most of it was not what I expected going in.

## 1. Agreeing with federal law does not save a state statute

The obvious model of a legal conflict is disagreement: one sovereign permits, another forbids. That model covers six of the thirteen conflicts in the corpus. The other seven are field preemption, and in every one of them **both rules say the same thing**.

Federal registration law and Arizona's S.B. 1070 § 3 both prohibit failing to carry registration documents. No contradiction exists between them in any logical sense. § 3 was preempted anyway, because Congress occupied the field.

Alabama's H.B. 56 § 10 is the extreme case. It is *defined by reference to* violations of the federal registration sections — it could not agree with federal law more closely if it tried. The Eleventh Circuit enjoined it regardless: even complementary state regulation is impermissible. A logic that only knows about contradiction cannot see this at all. It needed a separate axiom whose second premise is a disjunction over *every* deontic status, because what's forbidden is the state speaking in that field at all, not what it says.

## 2. The most interesting fact is a missing axiom

There are three deontic statuses in the corpus (allowed, prohibited, required) and therefore three possible exclusion pairs. Only two of them are real.

Allowed/prohibited is a contradiction. Prohibited/required is a contradiction. Allowed/required is **not**, because a mandatory act is trivially also a permitted one — and that gap is where a lot of real federalism lives. Federal law makes E-Verify voluntary. Arizona made it mandatory for employers. The Supreme Court upheld Arizona in *Chamber of Commerce v. Whiting*. Same for S.B. 1070 § 2(B): federal law permits status-check cooperation, Arizona required it, and § 2(B) survived facial challenge while the rest of the act fell.

So the corpus, read as a whole, states a rule I did not know before I built it: **a state may require what federal law merely permits, but not what it forbids.** Two of my fifteen pairings are "no conflict," and they're the two that best explain what preemption is not.

## 3. One provision, two independent grounds

Arizona's A.R.S. § 13-2929 gets caught twice — once for contradicting the federal religious-volunteer safe harbor (a real disagreement: federal law permits, Arizona prohibits), and once for intruding on the federal harboring field (both prohibit; doesn't matter).

I initially treated this as a bug, a duplicate finding to deduplicate away. Then I read the Ninth Circuit opinion and found it had done exactly the same thing in consecutive sections: field preempted *and* conflict preempted. Two independent routes to the same outcome is how courts actually reason, because either ground alone survives if the other is wrong on appeal.

The tool now reports only the preemption when a pair qualifies as both, since preemption is dispositive regardless of content. I'm still not sure that's right. It's a display decision that quietly discards a second, valid legal argument.

## 4. Constitutional rules are the worst fit for any schema

Statutes formalize well. They tend to say: this person, doing this thing, is committing a misdemeanor. That is a subject, an activity, a condition, and a deontic status — exactly the five fields in my frontmatter.

Constitutional doctrine does not cooperate. *Plyler v. Doe*'s actual rule is that a state may not deny free public education to undocumented children **unless doing so furthers some substantial state interest**. That trailing clause is a standard applied to the state's justification, not an element of an offense. I encoded it as an unconditional `prohibited`, which drops the escape hatch entirely and makes the rule look more absolute than it is.

The interesting part: this simplification runs in the *opposite* direction from the harboring one in the same corpus, where an exactly-matched activity key makes a rule look narrower than it is. So the corpus's errors don't share a sign. You can't correct for them with a confidence discount.

## 5. The legal judgment is hiding in one boolean

Every field in a statute file is read off the text — citation, subject, activity, condition, action. Except one. `exclusive: true` marks a rule as occupying a field, and Congress never writes that. Courts infer it from how comprehensive a scheme looks.

So the single most consequential input to the tool is the one thing that isn't in the statute. Three rules in the corpus carry the flag (registration, harboring, document fraud), and those three flags generate seven of the thirteen conflicts. A wrong flag propagates silently through machine-checked derivations and comes out the other end wearing a proof.

This is the thing I'd want anyone evaluating a neurosymbolic legal tool to ask about: not whether the reasoning is verified, but which premise had to be supplied by a human, and how much work that premise is doing. Here the derivation is checked by Lean; the premise that starts it is a judgment call I made.

---

One honest caveat about the headline result. The tool's verdicts match how courts ruled in all fifteen pairings — thirteen conflicts that were struck down or enjoined, two compatible pairs that were upheld. That sounds like validation, and it isn't: I built the corpus *from litigated provisions*, precisely so that every branch of the logic would be exercised against law with a known answer. Selection on the outcome variable. The right test is a provision nobody has challenged yet, where the tool's answer can't be graded against a case report. That's what I want to try next.
