/**
 * A worked example: greet people, and give them somewhere to read the rules.
 *
 * Small on purpose. It uses a command, an event and a panel -- the three
 * things a plugin can do -- so copying this file is a reasonable way to start
 * a real one.
 */

export function register(ctx) {
  const RULES = [
    'Killing a player takes a quarter of what they are carrying.',
    'The shop is B, or /shop. Selling pays about half of buying.',
    'Money survives a reconnect. Your name is your account.',
    'Be decent to people who just joined; they have nothing worth taking.',
  ];

  ctx.on('join', (player) => {
    ctx.tell(player.name, `Welcome to ${ctx.serverName}. Press B for the shop, or /rules.`);
  });

  ctx.command('rules', 'what this server expects', (player) => {
    for (const line of RULES) ctx.tell(player.name, line);
  });

  // A panel with no buttons is still a panel: this one is just something to
  // read, addressed as "rules" from the client.
  ctx.panel('rules', () => ({
    t: 'panel',
    id: 'rules',
    title: `${ctx.serverName} rules`,
    rows: RULES.map((label) => ({ label })),
  }));
}
