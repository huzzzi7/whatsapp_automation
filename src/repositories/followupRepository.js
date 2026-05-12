async function insertQueuedJob({ greenInstanceDbId, phoneNormalized, campaignId, step, dueAt }) {
  return { insertId: 0, affectedRows: 0 };
}

async function markEnqueued(id) {
}

async function markSent(id) {
}

async function markFailed(id, error) {
}

async function cancelPendingForConversation(greenInstanceDbId, phoneNormalized) {
}

module.exports = {
  insertQueuedJob,
  markEnqueued,
  markSent,
  markFailed,
  cancelPendingForConversation,
};

