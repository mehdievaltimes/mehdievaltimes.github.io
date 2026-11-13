"""clmlite: a small Context-Language-Model harness used to produce runs for ctxvc.

One model, one bash tool, and the context mirrored to a file the model may edit.
It follows the turn protocol of the released CLM harness (mirror, command, read
back, edit gate, one-line receipt) but is written to be resumable from any saved
step, which is what counterfactual replay needs.
"""
