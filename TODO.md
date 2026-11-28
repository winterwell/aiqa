TODO

View by conversation id - we have - make it easier to find
Better conversation view

Attribution for agentic systems:
Problem: multi-step and multi-turn flows
Solutions:
Attribute blame to particular steps (credit is not worth attributing as good is needed at most steps)
 - manually: user picks the steps to blame
 - LLM: identify the end problem (ideally with user input), then look for the cause. Can use other good/unknown runs for comparison (provide a tool).
 - data-science: if we have enough data
     - look for markers that distinguish good/bad runs
     - advanced: make the steps differentiable by a proxy small network acting at a simplified level
 - smart: shifts towards data-driven as data grows
Note: Steps are sequential and hierarchical. Blame can be set at any level or across a few steps.
Total blame should sum to 1. If there were several different issues, then split them out.
Once we have blame - analyse by llm for cause in prompts


Drift detection and test coverage / gaps feature:

Tracing without otel? ...
Browser extension?

# Funding
https://www.mozillafoundation.org/en/what-we-do/grantmaking/

Football analogy for why more than one model might be used in
a multi-agent system
e.g. you could have 11 Lionel Messis, but

Dataset - auto sample + auto tag
(With human tools too)

Experiments - user describes the options they want to explore - then experiment-runner auto samples and explores
With cost management

Website - lead with the user Qs: 
How do I make my AI cheaper / faster / more reliable / safer

## Snags

api keys menu - go to (a) first
leftnav sub menu a b c