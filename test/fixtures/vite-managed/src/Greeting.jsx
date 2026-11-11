import { greeting } from './message.js';

export function Greeting({ name = 'world' }) {
  return <p id="greeting">{greeting(name)}</p>;
}

export default Greeting;
