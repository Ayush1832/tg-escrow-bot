const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry(fn, retries = 3, delay = 1000) {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) throw error;

    // Check if error is retryable
    const isNetworkError =
      error.code === "ETIMEDOUT" ||
      error.code === "ECONNRESET" ||
      error.code === "EAI_AGAIN" ||
      (error.message &&
        (error.message.includes("timeout") ||
          error.message.includes("network")));

    if (!isNetworkError) throw error;

    console.warn(
      `Operation failed, retrying in ${delay}ms... (${retries} attempts left). Error: ${error.message}`
    );
    await wait(delay);
    return withRetry(fn, retries - 1, delay * 2);
  }
}

module.exports = withRetry;
