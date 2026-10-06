const ISOLATION_LEVELS = new Set([
  'READ UNCOMMITTED',
  'READ COMMITTED',
  'REPEATABLE READ',
  'SERIALIZABLE',
]);

const transactions = new WeakMap();

export function transactionContext(database) {
  return transactions.has(database) ? Object.freeze({ managed: true, state: 'active' }) : null;
}

export async function dispatchAfterCommit(database, action) {
  const transaction = transactions.get(database);
  if (transaction) {
    transaction.actions.push(action);
    return;
  }
  await action(database, null);
}

function validateOperation(database, operation) {
  if (!database) throw new Error('Database connection is required');
  if (typeof operation !== 'function') throw new Error('Transaction operation is required');
}

function joinTransaction(connection, operation, options) {
  if (options.isolationLevel && String(options.isolationLevel).toUpperCase() !== transactions.get(connection).isolationLevel) {
    throw new Error('A nested transaction cannot change the outer isolation level');
  }
  return operation(connection);
}

async function setIsolationLevel(connection, isolationLevel) {
  if (!isolationLevel) return;
  const level = String(isolationLevel).toUpperCase();
  if (!ISOLATION_LEVELS.has(level)) {
    throw new Error(`Unsupported transaction isolation level: ${isolationLevel}`);
  }
  await connection.query(`SET TRANSACTION ISOLATION LEVEL ${level}`);
}

async function executeTransaction(connection, operation, options) {
  await setIsolationLevel(connection, options.isolationLevel);
  await connection.beginTransaction();
  const transaction = { actions: [], isolationLevel: options.isolationLevel ? String(options.isolationLevel).toUpperCase() : null };
  transactions.set(connection, transaction);

  try {
    const result = await operation(connection);
    await connection.commit();
    return { result, actions: transaction.actions };
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  } finally {
    transactions.delete(connection);
  }
}

async function finishActions(committed, database) {
  const context = Object.freeze({ managed: true, state: 'committed' });
  for (const action of committed.actions) await action(database, context);
  return committed.result;
}

export async function withConnectionTransaction(connection, operation, options = {}) {
  validateOperation(connection, operation);
  if (transactions.has(connection)) return joinTransaction(connection, operation, options);
  const committed = await executeTransaction(connection, operation, options);
  // This connection belongs to the caller and remains usable for post-commit actions.
  return finishActions(committed, connection);
}

export async function withTransaction(pool, operation, options = {}) {
  validateOperation(pool, operation);
  if (transactions.has(pool)) return joinTransaction(pool, operation, options);
  if (typeof pool.getConnection !== 'function') return withConnectionTransaction(pool, operation, options);
  const connection = await pool.getConnection();
  let committed;
  try {
    committed = await executeTransaction(connection, operation, options);
  } finally {
    connection.release();
  }
  // Return the borrowed connection before hooks acquire connections from the pool.
  return finishActions(committed, pool);
}
