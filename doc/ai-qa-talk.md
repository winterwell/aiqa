

## Talk Overview: AI Testing for Adults

Not:
Eat Your Greens, Tidy Your Room, Test Your AI.

Yes:
When to test (think like an Investor).
How to test (think like a Doctor and a Robot).
Pitfalls (aka How not to waste time).


Script:
This workshop is about testing. Testing software in general, and the particular challenges of testing AI.
It is a universal truth that more testing would be good.
You're adults. I won't tell you to eat your greens, tidy your room, or write tests for your AI. 
You already know you should. Also, you're adults and you can make your own decisions.
This talk will cover:

 - When to test
 - How to test
 - And we'll cover some pitfalls

## War Stories

TODO a short game/session to share war stories from me and the audience.


## Test like: an Investor

Testing is an investment decision.

Return on Investment (ROI) - for Time and Risk.


Script:
Testing is an investment decision. 
Everyone understands it's an investment. It costs time.
Let's be honest about the decision part of that: Because it is a decision - You don't have to test.
People release poorly tested software all the time. Call it "Customer as QA"

You invest in testing -- paying an upfront time cost, and an ongoing cost of maintaining the tests.
You get back - less bugs, reduced risk of issues (not zero risk, but the more you test, the lower the risk),
and faster development. A good test process should speed up development.
You invest time to get time back longer term.

When should you invest and how much should you invest?

If the risks are serious, such as with a medical device or an aircraft.
Boeing 737 Max was a disaster -- actually several disasters -- because they didn't properly test the new AI software.


For most of our companies, a bug or the wrong output would not be life-threatening.
So: Here are some signals that you should invest more:

- If you're spending significant time checking the software.
- If you find you're re-running AI chats a few times to see what happens.
- If you're tweaking a prompt or other AI parameters, to try and improve the output. 
- If the AI kind of works, but you want to improve it.
- If you're spending a lot of money on AI credits, and you want to reduce that cost.
- Of course, if you're hearing complaints from users.


## Test like: a Doctor

A doctor doesn't just prescribe drugs blindly. They diagnose the problem first. They run checks to confirm the diagnosis.

The software equivalent is:

1. Reproduce the problem, manually.
2. Write a unit test that reproduces the problem automatically.
3. Now you can work on fixing the issue efficiently.
4. The test should confirm the fix.

## Test like: a Punk (Red Team Testing #1)

Challenge everything. Break the system.

This is where the Red Team -- ideally they're a different group of people from the developers, though it might just be you with a different hat on.
The Red Team try to break the system.
They start out like a normal user, but if that works, well they get more creative.

For AI systems - red team testing can help catch dangerous flaws.
Like 

For a start-up, a nice way to do red team testing, is to make it into a game.
Schedule some time for a bug hunt. Everyone. Make it fun. Have prizes for the most bugs found, the most serious bug, the funniest bug.

A software tester walks into a bar. Orders a beer. Orders 999 beers. Orders 1.4 beers. Orders -1 beers. Orders a lizard.

## Test like: a Criminal (Red Team Testing #2)

Ask: How can this new feature be used to hack, cheat, and steal?

Does anyone use one of the new browsers, like Atlas from ChatGPT, or Comet from Perplexity?
The criminal world will, I'm sure, appreciate your donations.
We know, from independent red-team research, that these are currently vulnerable to prompt injection attacks, and manipulation via hidden text.

## Test like: a Grandma

You are smart savvy people. You understand your domain, and your system.
The user -- might not be as smart, and they certainly won't be as informed about your software as you are.

## Test like: a Robot / Jeff Bezos

- Automation
- Scale
- Speed

Script:
TODO: a one-liner joke where Jeff Bezos is the cold calculating choice vs a robot.

## Testing in Production


# Why AI Testing is Hard

Normal software testing is already hard.
AI testing adds:

 - Unpredictable behaviour.
 - The correct output can be an open-ended range of possible outputs. 
   - In normal software, there's usually one correct output. 2+2 should be 4. 
   - But for generative AI, like chatbots, there can be many correct outputs.
 - Performance is often qualitative, and requires judgement to measure.

# Practical AI Testing - an example

Run our system ??

# Pitfalls

## No Ownership / Follow Through

A spurt of testing -- won't give long-term benefits unless it becomes part of the process.

Someone has to own the testing process, and care about it.

## Unhelpful Tools

??

## Over-engineering vs KISS


## Poke and Hope 

Where you poke the prompt here, try it out -- seems to fix the issue you're looking at today.

1. This approach eats time.
2. With AI systems, a fix for one issue can create another issue somewhere else. 


