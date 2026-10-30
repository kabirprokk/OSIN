'use strict';

const COMMANDS = [
  ['/new', 'Start a fresh chat'], ['/clear', 'Clear this chat and its files'],
  ['/undo', 'Remove the last user turn'], ['/attach <path>', 'Attach a UTF-8 text file'],
  ['/files', 'List attached files'], ['/detach N', 'Remove attachment number N'],
  ['/copy', 'Copy the last OSIN response'], ['/usage', 'Show provider-reported token usage'],
  ['/models', 'List models available from your provider'],
  ['/update', 'Check for and install the latest OSIN release'],
  ['/settings', 'Change the model'], ['/model NAME', 'Set the model for this session'],
  ['/support', 'Open the OSIN donation/support page'], ['/help', 'Show command help'],
  ['/exit', 'Exit OSIN'],
];

function getCommandSuggestions(query, limit = 4) {
  const normalized = String(query).toLowerCase();
  return COMMANDS.filter(([command]) => command.toLowerCase().startsWith(normalized))
    .slice(0, Math.max(0, limit));
}

module.exports = { COMMANDS, getCommandSuggestions };
