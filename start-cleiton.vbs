Option Explicit

Dim shell, fso, projectDir, logDir, command, exitCode, logFile

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
logDir = projectDir & "\logs"
logFile = logDir & "\cleiton.log"

If Not fso.FolderExists(logDir) Then
  fso.CreateFolder(logDir)
End If

Do
  EnsureSingleBotProcess
  If BotRunning() Then
    WScript.Sleep 10000
  Else
    command = "cmd.exe /c cd /d """ & projectDir & """ && echo ==== Cleiton start %date% %time% ==== >> """ & logFile & """ && npm.cmd start >> """ & logFile & """ 2>&1"
    exitCode = shell.Run(command, 0, True)
    shell.Run "cmd.exe /c echo ==== Cleiton caiu com codigo " & exitCode & " em %date% %time%; reiniciando em 10s ==== >> """ & logFile & """", 0, True
    WScript.Sleep 10000
  End If
Loop

Function BotRunning()
  Dim wmi, processes, process
  BotRunning = False
  Set wmi = GetObject("winmgmts:\\.\root\cimv2")
  Set processes = wmi.ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name = 'node.exe'")
  For Each process In processes
    If InStr(1, process.CommandLine, "src/knight/cleiton-baileys.js", vbTextCompare) > 0 Then
      BotRunning = True
      Exit Function
    End If
  Next
End Function

Sub EnsureSingleBotProcess()
  Dim wmi, processes, process, keeperId, keeperCreated
  keeperId = 0
  keeperCreated = ""
  Set wmi = GetObject("winmgmts:\\.\root\cimv2")
  Set processes = wmi.ExecQuery("SELECT ProcessId, CommandLine, CreationDate FROM Win32_Process WHERE Name = 'node.exe'")
  For Each process In processes
    If InStr(1, process.CommandLine, "src/knight/cleiton-baileys.js", vbTextCompare) > 0 Then
      If keeperId = 0 Or process.CreationDate < keeperCreated Then
        keeperId = process.ProcessId
        keeperCreated = process.CreationDate
      End If
    End If
  Next
  Set processes = wmi.ExecQuery("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = 'node.exe'")
  For Each process In processes
    If InStr(1, process.CommandLine, "src/knight/cleiton-baileys.js", vbTextCompare) > 0 Then
      If process.ProcessId <> keeperId Then
        shell.Run "cmd.exe /c echo ==== Cleiton matou instancia duplicada PID " & process.ProcessId & " em %date% %time% ==== >> """ & logFile & """", 0, True
        process.Terminate()
      End If
    End If
  Next
End Sub
