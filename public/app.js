const message = document.querySelector("#form-message");
const resultPanel = document.querySelector("#result-panel");
const resultBody = document.querySelector("#result-body");
const clearButton = document.querySelector("#clear-button");
const googleButton = document.querySelector("#google-signin-button");
const apiBase = document.querySelector("meta[name='grade-api-base']")?.content.trim().replace(/\/$/, "") || "";
const googleClientId = document.querySelector("meta[name='google-client-id']")?.content.trim() || "";

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

async function handleGoogleCredential(response) {
  if (!response || !response.credential) {
    setMessage("Google Sign-In did not return a credential.", true);
    return;
  }

  setMessage("Checking your UCLA Google account...");
  resultPanel.hidden = true;
  resultBody.replaceChildren();

  try {
    const apiResponse = await fetch(apiUrl("api/google-lookup"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: response.credential })
    });

    const contentType = apiResponse.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await apiResponse.json() : {};
    if (!apiResponse.ok) {
      throw new Error(payload.error || "Grade lookup service is not connected yet.");
    }

    renderResults(payload.grades);
    setMessage(`Matched by ${payload.matchedBy}.`);
  } catch (error) {
    setMessage(error.message, true);
  }
}

function initializeGoogleSignIn() {
  if (!googleClientId) {
    setMessage("Google Sign-In is not configured yet.", true);
    return;
  }

  if (!window.google || !window.google.accounts || !window.google.accounts.id) {
    setMessage("Google Sign-In could not be loaded.", true);
    return;
  }

  window.google.accounts.id.initialize({
    client_id: googleClientId,
    callback: handleGoogleCredential,
    auto_select: false
  });

  window.google.accounts.id.renderButton(googleButton, {
    theme: "outline",
    size: "large",
    type: "standard",
    text: "continue_with",
    shape: "rectangular",
    width: 320
  });
}

window.addEventListener("load", initializeGoogleSignIn);

clearButton.addEventListener("click", () => {
  resultBody.replaceChildren();
  resultPanel.hidden = true;
  setMessage("");
});
