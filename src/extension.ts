// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as child_process from 'child_process';

const WORKSPACE_FOLDER = '${workspaceFolder}';
const ENV_VAR_REGEX = new RegExp('\\$\\{env:([^}]+)\\}');

// const logger = vscode.window.createOutputChannel('vscode-autoflake');

function resolveWorkspaceFolder(filePath: string): string {
  if (filePath.indexOf(WORKSPACE_FOLDER) == -1) {
    return filePath;
  }

  const uri = vscode.window.activeTextEditor?.document?.uri;
  if (uri) {
    let workspaceFolderPath = vscode.workspace.getWorkspaceFolder(uri);
    if (workspaceFolderPath === undefined) {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders?.length) {
        workspaceFolderPath = workspaceFolders[0];
      }
    }
    if (workspaceFolderPath) {
      return filePath.replace(WORKSPACE_FOLDER, workspaceFolderPath.uri.fsPath);
    }
  }
  return filePath;
}

function resolveEnvVar(text: string): string {
  const envVarNames = [];

  let result = '';
  let tmp = text;
  while (tmp != '') {
    const m = ENV_VAR_REGEX.exec(tmp);
    if (m) {
      const envVarName = m[1];
      envVarNames.push(envVarName);

      const matchedString = m[0];
      const startIndex = tmp.indexOf(matchedString);
      const endIndex = startIndex + matchedString.length;
      const envVarValue = process.env[envVarName];
      result += tmp.substring(0, startIndex) + envVarValue;
      tmp = tmp.substring(endIndex);
    } else {
      result += tmp;
      break;
    }
  }

  return result;
}

function resolvePath(filePath: string): string {
  filePath = resolveWorkspaceFolder(filePath);
  filePath = resolveEnvVar(filePath);
  return filePath;
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

  const remove_unused = (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit) => {
    // python config
    let pythonConfig = vscode.workspace.getConfiguration('python');
    const isortPath = resolvePath(pythonConfig.get('sortImports.path', ''));
    const isortArgs = pythonConfig.get('sortImports.args', []);
    // autoflake config
    let config = vscode.workspace.getConfiguration('autoflake');
    const verbose = config.get('verbose');
    const sort_imports = config.get('sortImports');
    const all_imports = config.get('removeAllUnusedImports');
    const remove_vars = config.get('removeAllUnusedVariables');
    const remove_duplicate = config.get('removeDuplicateKeys');
    const autoflake = resolvePath(config.get('path', ''));
    // get the activate editor
    const filepath = textEditor.document.uri.fsPath;
    // skip if not python file
    if (textEditor.document.languageId != 'python') {
      vscode.window.showErrorMessage('Skip autoflake, not python script.')
      return;
    }
    // prepare the isort script
    let isort_script = '';
    if (sort_imports && isortPath.length > 0) {
      isort_script = `& ${isortPath} ${isortArgs.join(' ')} '${filepath}'`;
    }
    // skip if not python file
    const exec_script = `'${autoflake}' --in-place \
      ${all_imports ? '--remove-all-unused-imports' : ' '} \
      ${remove_vars ? '--remove-unused-variables' : ' '} \
      ${remove_duplicate ? '--remove-duplicate-keys' : ' '} \
      '${filepath}' ${isort_script}`;
    // execute the script in child process
    child_process.exec(exec_script,
      (err, stdout, stderr) => {
        // show running script
        if (verbose) {
          vscode.window.showInformationMessage(exec_script);
          if (stdout.length > 0) {
            vscode.window.showInformationMessage('stdout: ' + stdout);
          }
        }
        if (err) {
          vscode.window.showErrorMessage(stderr);
        }
      });
  }

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  let cmd = vscode.commands.registerTextEditorCommand('autoflake.removeUnused', remove_unused);
  context.subscriptions.push(cmd);
}

// this method is called when your extension is deactivated
export function deactivate() { }
