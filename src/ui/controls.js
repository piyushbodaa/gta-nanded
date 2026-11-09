// What to press for each action on the device being played: keyboard, gamepad,
// or the on-screen touch buttons. Help text is written once and reads right on all three.
const NAMES = {
  keyboard: {
    gas: 'W', brake: 'S', handbrake: 'Space', horn: 'H', radio: 'R', camera: 'V', enter: 'F', exit: 'F', map: 'M', pause: 'Esc',
    job: 'N', action: 'Q', siren: 'Q', attack: 'J', photo: 'X', sprint: 'Shift', jump: 'Space',
    fire: 'Click', aim: 'Right-click', reload: 'R', wheel: 'Tab', weaponNext: 'Scroll', weaponPrev: 'Scroll', grenade: 'G',
  },
  gamepad: {
    gas: 'RT', brake: 'LT', handbrake: 'A', horn: 'L3', radio: 'RB', camera: 'LB', enter: 'Y', exit: 'Y', map: 'Back', pause: 'Start',
    job: 'D-pad ↑', action: 'X', siren: 'X', attack: 'B', photo: 'D-pad ↓', sprint: 'L3', jump: 'A',
    fire: 'RT', aim: 'LT', reload: 'B', wheel: 'RB', weaponNext: 'D-pad →', weaponPrev: 'D-pad ←',
  },
  touch: {
    gas: 'GAS', brake: 'BRAKE', handbrake: 'DRIFT', horn: 'HORN', radio: '📻', camera: '🎥', enter: 'ENTER', exit: 'EXIT', map: 'MAP', pause: '❚❚',
    job: 'START JOB', action: 'the action button', siren: 'SIREN', attack: 'PUNCH', photo: '📷', sprint: 'RUN', jump: 'JUMP',
    fire: 'FIRE', aim: 'AIM', reload: 'RELOAD', wheel: 'the weapon button', weaponNext: 'the weapon button', weaponPrev: 'the weapon button',
  },
};

/** 'keyboard', 'gamepad' or 'touch': whatever the player last used. */
export const device = game => game.input.mode;

/** The name of the key or button for an action, as plain text. */
export const keyName = (game, action) => NAMES[device(game)][action] ?? action;

/** The key or button for an action, as a key cap. */
export function key(game, action) {
  return `<kbd${device(game) === 'touch' ? ' class="tap"' : ''}>${keyName(game, action)}</kbd>`;
}

/** 'press' on a keyboard or gamepad, 'tap' on a touch screen. */
export const verb = game => (device(game) === 'touch' ? 'tap' : 'press');

/** "Press F" / "Tap ENTER" for an action. */
export const press = (game, action) => `${device(game) === 'touch' ? 'Tap' : 'Press'} ${key(game, action)}`;

/** Pick the sentence written for the device in use: { keyboard, gamepad, touch }. */
export const pick = (game, text) => text[device(game)] ?? text.keyboard;

/** How to drive, for the first time behind the wheel. */
export function drivingHelp(game) {
  const k = a => key(game, a);
  return pick(game, {
    keyboard: `Hold ${k('gas')} to drive, <kbd>A</kbd>/<kbd>D</kbd> to steer, ${k('brake')} to brake and reverse, ${k('handbrake')} for the handbrake.`,
    gamepad: `Hold ${k('gas')} to drive, steer with the left stick, ${k('brake')} to brake and reverse, ${k('handbrake')} for the handbrake.`,
    touch: `Hold ${k('gas')} to drive and steer with your left thumb. Hold ${k('brake')} to stop and reverse, ${k('handbrake')} to slide.`,
  });
}

/** How to shoot, for the first gun picked up. */
export function weaponHelp(game) {
  const k = a => key(game, a);
  return pick(game, {
    keyboard: `${k('fire')} fire · hold ${k('aim')} to aim · ${k('reload')} reload · hold ${k('wheel')} for the weapon wheel, or ${k('weaponNext')} / <kbd>1</kbd>–<kbd>7</kbd> to switch.`,
    gamepad: `${k('fire')} fire · ${k('aim')} aim · ${k('reload')} reload · hold ${k('wheel')} for the weapon wheel, ${k('weaponPrev')} ${k('weaponNext')} to switch.`,
    touch: `${k('fire')} shoots (drag on it to turn) · ${k('aim')} aims · tap ${k('wheel')} to choose a weapon.`,
  });
}

/** The other things to do behind the wheel. */
export const vehicleKeys = game => `${key(game, 'horn')} horn · ${key(game, 'radio')} radio · ${key(game, 'exit')} get out`;
