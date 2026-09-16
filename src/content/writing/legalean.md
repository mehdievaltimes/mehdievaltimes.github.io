---
title: "Legalean: Proving That Two Statutes Contradict Each Other"
date: 2026-09-16
tags: [lean, formal-methods, law]
---

Two laws can tell you opposite things. Arizona's S.B. 1070 § 5(C) made it a misdemeanor for an unauthorized immigrant to apply for or perform work. Federal immigration law had deliberately declined to criminalize that same act — Congress penalized employers, not workers. In *Arizona v. United States* the Supreme Court struck § 5(C) down for exactly that reason.

That's a contradiction a machine should be able to check. So I built [Legalean](https://github.com/mehdievaltimes/legalean): it turns statutory excerpts into structured deontic rules and hands each candidate pair to the Lean 4 kernel. A conflict is reported only if Lean accepts a proof of `False` from the two rules. Not a similarity score, not a Python `assert` — a proof term that type-checks.

## The pipeline

```
statutes/*.md → rules → Python pre-filter → generated Lean → lake env lean → confirmed conflicts
```

The corpus is 24 markdown files, one statutory excerpt each, across six jurisdictions. The formalization lives in the frontmatter and the reasoning lives underneath it in prose, so a human can audit the encoding without reading any code:

```markdown
---
id: az-sb1070-5c
jurisdiction: Arizona State
citation: Ariz. Rev. Stat. § 13-2928(C) (S.B. 1070 § 5(C))
subject: unauthorized alien
activity: seeking or engaging in unauthorized employment
condition: always
action: prohibited
scope: Arizona State
---
```

The Python layer does **not** decide whether two rules conflict. It decides which pairs are worth asking Lean about: same `activity` key, overlapping scopes, contradictory actions, and — critically — a constructible *witness*, a concrete case both conditions cover. Then it generates one self-contained Lean file per candidate and shells out to the compiler.

## The Lean side is tiny

The entire logical commitment is five lines:

```lean
axiom Allowed : Prop → Prop
axiom Prohibited : Prop → Prop
axiom Required : Prop → Prop

axiom allowed_prohibited_excl (p : Prop) : Allowed p → Prohibited p → False
axiom prohibited_required_excl (p : Prop) : Prohibited p → Required p → False
```

The modalities are opaque. Lean knows nothing about what "allowed" means; it only knows these exclusions. What's interesting is the pair that is deliberately *absent*: allowed/required is not a contradiction, because a mandatory act is trivially a permitted one. That omission is load-bearing on real law. Federal law makes E-Verify voluntary; Arizona made it mandatory; the Supreme Court upheld the state law in *Chamber of Commerce v. Whiting*. The tool is silent on that pair, and it should be. Put together, the corpus says a state may require what federal law merely permits, but not what it forbids.

A generated proof instantiates both rules at the shared witness and closes with the matching axiom:

```lean
theorem conflict_us_const_equal_protection_education_vs_tx_educ_code_21_031
    (ruleA : (∀ x : Int, x > 5 → Allowed (Activity x)))
    (ruleB : (∀ x : Int, True → Prohibited (Activity x))) :
    False :=
  allowed_prohibited_excl (Activity 6) (ruleA 6 (by omega)) (ruleB 6 trivial)
```

That's the *Plyler v. Doe* pair, and the `6` matters. Texas's school-enrollment statute carried an age floor, so Python computes a witness satisfying `age > 5` and Lean re-checks with `omega` that the witness really satisfies the premise, rather than taking Python's word for it. If the witness is bogus, the file doesn't compile and the pair is dropped. That's the actual guarantee: not "my filter found a conflict" but "the kernel accepted a derivation."

## Field preemption is a different animal

Halfway through I hit a kind of conflict the exclusion axioms can't express. Federal alien-registration law doesn't just *disagree* with Arizona's § 3 — it occupies the field, so any state rule there collides with it *even one that agrees*. Both rules say `prohibited`. There is no deontic contradiction at all. It's still preempted.

```lean
axiom ExclusivelyFederal : Prop → Prop

axiom field_preemption_excl (p : Prop) :
    ExclusivelyFederal p → (Allowed p ∨ Prohibited p ∨ Required p) → False
```

The second premise is a disjunction over all three modalities, and the generated proof injects whatever the displaced rule actually says, so the theorem is about the real rule rather than a paraphrase. Alabama's H.B. 56 § 10 is the sharpest case: it is defined by reference to violations of the federal registration sections, so it could hardly agree more closely, and the Eleventh Circuit enjoined it anyway — "even complementary state regulation is impermissible."

## The bug that taught me the most

Activity matching started as fuzzy matching, and it manufactured a conflict.

South Carolina and Georgia both criminalize harboring, but each adds an element the federal offense lacks — specific intent in one, commission of another offense in the other. A subset-based matcher joined the narrower state offense to the broader federal rule and then reasoned as though the state rule reached every case the federal one did. The extra element lives in the activity phrase, which the `condition` field never captures. So the tool "found" a contradiction that doesn't follow.

The fix was to make `activity` an exact key on a normalized token set, not a similarity score — with one exception. Field preemption asks only whether the state rule regulates *inside* the field, so a narrower offense still matches there; that's the whole point of occupying a field. Splitting those two matching rules is what lets the tool say Georgia's § 7 is field-preempted while staying silent on whether it contradicts the religious safe harbor, which would require knowing whether a volunteer minister could ever satisfy the extra element.

Exact matching trades one failure mode for another: a typo now silently hides a real conflict. So the tool lints for keys that are similar but unequal and shouts about them on stderr. `'failing to carry alien registration document'` versus `'...documents'` is either one act spelled two ways or two different acts, and a threshold cannot tell those apart. A human can.

## What "formally verified" does not mean

Lean verifies that the *formalized* rules are inconsistent. It never verifies that the formalization is faithful to the statute, and that step is manual. *Plyler*'s actual rule is a standard applied to a state's justification, not a flat ban; encoding it as an unconditional `prohibited` makes it look more absolute than it is.

Worse, `exclusive: true` — the flag that triggers field preemption — is a judicial holding, not statutory text. Congress does not write "we occupy this field"; courts infer it. Marking a rule exclusive feeds a legal conclusion into the tool and then derives consequences from it. The derivation is machine-checked; the premise is a judgment call, and a wrong one propagates silently.

And jurisdiction isn't in Lean at all. The modalities carry no scope, so nothing in the encoding knows federal law outranks state law. `scopes.py` enforces that before a theorem is ever generated. Lean checks the deontic and arithmetic core; Python supplies the jurisdictional premise. "Formally verified" should be read against that boundary — which is, I think, the honest version of the claim most neurosymbolic legal-AI work makes.

Current corpus: 24 rules, 13 Lean-verified conflicts — six contradictions and seven field preemptions — and two pairs the tool correctly reports as compatible, both of which courts upheld. No API key, no network, no third-party Python. `python3 check_conflicts.py` runs the whole thing.
