const form = document.querySelector("#lookup-form");
const input = document.querySelector("#identifier");
const message = document.querySelector("#form-message");
const resultPanel = document.querySelector("#result-panel");
const resultBody = document.querySelector("#result-body");
const clearButton = document.querySelector("#clear-button");
const apiBase = document.querySelector("meta[name='grade-api-base']")?.content.trim().replace(/\/$/, "") || "";

function apiUrl(path) {
  const cleanPath = path.replace(/^\//, "");
  return apiBase ? `${apiBase}/${cleanPath}` : cleanPath;
}

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function renderResults(grades) {
  resultBody.replaceChildren(
    ...grades.map((grade) => {
      const row = document.createElement("tr");
      const assignment = document.createElement("td");
      const score = document.createElement("td");

      assignment.textContent = grade.assignment;
      score.textContent = grade.score || "-";

      row.append(assignment, score);
      return row;
    })
  );
  resultPanel.hidden = false;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const identifier = input.value.trim();
  if (!identifier) {
    setMessage("Please enter your SIS User ID or SIS Login ID.", true);
    return;
  }

  const submitButton = form.querySelector("button[type='submit']");
  submitButton.disabled = true;
  setMessage("Checking...");
  resultPanel.hidden = true;
  resultBody.replaceChildren();

  try {
    const response = await fetch(apiUrl("api/lookup"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier })
    });

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : {};
    if (!response.ok) {
      throw new Error(payload.error || "Grade lookup service is not connected yet.");
    }

    renderResults(payload.grades);
    setMessage(`Matched by ${payload.matchedBy}.`);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});

clearButton.addEventListener("click", () => {
  input.value = "";
  resultBody.replaceChildren();
  resultPanel.hidden = true;
  setMessage("");
  input.focus();
});
