// Copy paste from questions.md
const markdown = `
## Project Management

 - We have lots of work in progress.
 - Urgent requests and customer support issues regularly disrupt planned work.
 - It can be hard to tell what the team is actually working on.
 - Tasks either don't have delivery dates, or have delivery dates but regularly over-run.
 - Management and planning meetings take up more than 20% of staff time.
 - Work gets delayed by approval / sign-off queues.

## Coordination and Shared Knowledge

 - Some systems have a "only Alice knows how this works" person.
 - Important work lives in Slack/Teams/email/people's heads.
 - Tasks don't have a clear owner, and can get stuck in limbo.
 - We need meetings or messages to discover the status of ordinary work.
 - Onboarding new staff is slow.
 - People debate whether code matches what was asked for.

## Bugs & operational work

 - Customers/users often discover problems before we do.
 - Testing is mostly manual.
 - Bugs get reported but are sometimes forgotten or lost.
 - Issues surface in production which weren't visible in development.

## Release!

 - Work is sometimes "done" but not actually released.
 - Releases depend on a particular person.
 - Clients don't always get told of new features.

## Client Engagement

 - Someone reports a problem, we fix it, but nobody tells them.
 - Customer-facing staff can't easily see whether something has been fixed or released.
 - Designers and engineers have no customer contact.
 
## Measurement & Reliability

 - We don't know which features users actually use.
 - We can't estimate when features will be delivered.
 - We don't know how close servers are to falling over.

`;

// TODO save / load
let answers = {};

function renderQuestions() {
    let currentList;

const questionsEl = document.querySelector("#questions");
const scoreEl = document.querySelector("#score");

    for (const line of markdown.split(/\r?\n/)) {
      const header = line.match(/^(#{1,6})\s+(.+)$/);
      const question = line.match(/^\s*[-*+]\s+(.+)$/);

      if (header) { 
        const heading = document.createElement(`h${header[1].length}`);
        heading.textContent = header[2];
        questionsEl.append(heading);
        currentList = null;
      } else if (question) {
        if (!currentList) {
          currentList = document.createElement("div");
          questionsEl.append(currentList);
        }

        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";

        label.append(checkbox, document.createTextNode(` ${question[1]}`));
        currentList.append(label, document.createElement("br"));
      }
    }

    questionsEl.addEventListener("change", (event) => {
      if (event.target.matches('input[type="checkbox"]')) {
        scoreEl.textContent = questionsEl.querySelectorAll(
          'input[type="checkbox"]:checked'
        ).length;
      }
    });
  };

  setTimeout(renderQuestions, 1);
