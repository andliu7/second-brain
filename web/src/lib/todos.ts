// The daily todo card's pure logic, kept out of TodoCard.tsx so the rollover and the drag
// payload can be tested without a DOM.
import type { Todo, Todos } from '../types';
import { DEFAULT_TODOS, defaultTodo, defaultTodos, today } from './storage';

export const HISTORY_DAYS = 30;
export const TODO_DRAG_TYPE = 'application/x-brain-todo';

// What a todo becomes when dragged out of the card: the kanban reads this and makes a card. The
// todo itself stays put, so a drag is always a copy.
export const todoPayload = (todo: Todo) => ({ type: 'todo' as const, id: todo.id, text: todo.text, category: todo.category, minutes: todo.minutes ?? null, goal: todo.goal ?? null });

// Brings a stored todo list up to `day`. A missing list is the two defaults for today. A list from
// an earlier day sends its completed todos to history under that day, carries the unfinished ones
// forward and keeps the newest HISTORY_DAYS days. Either way, any default the user has not deleted
// for good and is not already in the list comes back. Returns the same object when nothing changed.
export function rollover(todos: Todos | undefined, day = today()): Todos {
  if (!todos) return defaultTodos(day);
  let next = todos;
  if (todos.day !== day) {
    const history = { ...todos.history };
    const done = todos.items.filter(t => t.done);
    if (done.length) history[todos.day] = [...(history[todos.day] ?? []), ...done];
    const kept = Object.keys(history).sort().slice(-HISTORY_DAYS);
    next = { ...todos, day, items: todos.items.filter(t => !t.done), history: Object.fromEntries(kept.map(k => [k, history[k]])) };
  }
  const missing = DEFAULT_TODOS.filter(d => !next.removedDefaults.includes(d.key) && !next.items.some(t => t.defaultKey === d.key));
  return missing.length ? { ...next, items: [...next.items, ...missing.map(d => defaultTodo(d.key))] } : next;
}

// Removes a todo; a built-in default is also flagged so rollover never brings it back.
export function removeTodo(todos: Todos, id: string): Todos {
  const gone = todos.items.find(t => t.id === id);
  return { ...todos, items: todos.items.filter(t => t.id !== id), removedDefaults: gone?.defaultKey && !todos.removedDefaults.includes(gone.defaultKey) ? [...todos.removedDefaults, gone.defaultKey] : todos.removedDefaults };
}
