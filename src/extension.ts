// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as process from 'process';

const WORKSPACE_FOLDER = '${workspaceFolder}';
const ENV_VAR_REGEX = new RegExp('\\$\\{env:([^}]+)\\}');
const ACTIVATED_PHRASE = ' (Activated)';

// const logger = vscode.window.createOutputChannel('vscode-autoflake');

function getWorkspaceFolderPath(): string | null {
  const uri = vscode.window.activeTextEditor?.document?.uri;
  let workspaceFolderPath: string | null = null;
  if (uri) {
    let workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (workspaceFolderPath === null) {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders?.length) {
        workspaceFolder = workspaceFolders[0];
      }
    }
    workspaceFolderPath = workspaceFolder?.uri?.fsPath || null;
  }
  return workspaceFolderPath;
}

function resolveWorkspaceFolder(filePath: string): string {
  if (filePath.indexOf(WORKSPACE_FOLDER) == -1) {
    return filePath;
  }

  const workspaceFolderPath = getWorkspaceFolderPath();
  if (workspaceFolderPath) {
    return filePath.replace(WORKSPACE_FOLDER, workspaceFolderPath);
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

function getPoetryPath(workspaceFolderPath: string): string {
  const pythonSection = vscode.workspace.getConfiguration('python');
  let poetryPathCandidate: string | undefined | null = null;
  if (pythonSection) {
    poetryPathCandidate = pythonSection.get('poetry');
    if (poetryPathCandidate) {
      poetryPathCandidate = resolveWorkspaceFolder(poetryPathCandidate);
      poetryPathCandidate = resolveEnvVar(poetryPathCandidate);
    }
  }
  poetryPathCandidate = poetryPathCandidate || 'poetry';

  if (fs.existsSync(poetryPathCandidate)) {
    return poetryPathCandidate;
  }

  const inCwd = path.join(process.cwd(), poetryPathCandidate);
  if (fs.existsSync(inCwd)) {
    return inCwd;
  }

  const inWorkspace = workspaceFolderPath
    ? path.join(workspaceFolderPath, poetryPathCandidate)
    : null;
  if (inWorkspace && fs.existsSync(inWorkspace)) {
    return inWorkspace;
  }

  const envPathText = process.env['PATH'];
  const delimiter = process.platform == 'win32' ? ';' : ':';
  const poetryRelativePath = poetryPathCandidate;
  const poetryPath = envPathText
    ?.split(delimiter)
    .map((envPath) => path.join(envPath, poetryRelativePath))
    ?.find((poetryPath) => fs.existsSync(poetryPath));

  return poetryPath || poetryPathCandidate;
}

function getPoetryVirtualenvPath(workspaceFolderPath: string): string | null {
  const poetryPath = getPoetryPath(workspaceFolderPath);
  const command = [
    'cd',
    workspaceFolderPath,
    '&&',
    poetryPath,
    'env',
    'list',
    '--full-path',
  ].join(' ');
  const result = child_process.execSync(command).toString();

  const candidate = result
    .split('\n')
    .find((line) => line.indexOf(ACTIVATED_PHRASE) > 0)
    ?.replace('\r', '')
    ?.replace(ACTIVATED_PHRASE, '');

  return candidate && fs.existsSync(candidate) ? candidate : null;
}

function getVirtualenvBinPath(): string | null {
  const workspaceFolderPath = getWorkspaceFolderPath();
  if (!workspaceFolderPath) {
    return null;
  }

  const pyprojectTomlPath = path.join(workspaceFolderPath, 'pyproject.toml');
  if (fs.existsSync(pyprojectTomlPath)) {
    const virtualenvPath = getPoetryVirtualenvPath(workspaceFolderPath);
    return virtualenvPath ? path.join(virtualenvPath, 'bin') : null;
  }

  return null;
}

function resolveAutoflakePath(filePath: string): string {
  let resolvedPath = resolvePath(filePath);

  if (fs.existsSync(resolvedPath)) {
    return resolvedPath;
  }

  const virtualenvBinPath = getVirtualenvBinPath();
  if (virtualenvBinPath) {
    resolvedPath = path.join(virtualenvBinPath, filePath);

    if (fs.existsSync(resolvedPath)) {
      return resolvedPath;
    }
  }

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
    const autoflake = resolveAutoflakePath(config.get('path', ''));
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
