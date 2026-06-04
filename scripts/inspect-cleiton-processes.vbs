Option Explicit

Dim fso, shell, projectDir, wmi, processes, process

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
projectDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
Set wmi = GetObject("winmgmts:\\.\root\cimv2")

Set processes = wmi.ExecQuery("SELECT ProcessId, ParentProcessId, Name, CreationDate, CommandLine FROM Win32_Process WHERE Name = 'node.exe' OR Name = 'wscript.exe' OR Name = 'cmd.exe'")

For Each process In processes
  If InStr(1, process.CommandLine & "", projectDir, vbTextCompare) > 0 Then
    WScript.Echo "Name=" & process.Name
    WScript.Echo "ProcessId=" & process.ProcessId
    WScript.Echo "ParentProcessId=" & process.ParentProcessId
    WScript.Echo "CreationDate=" & process.CreationDate
    WScript.Echo "CommandLine=" & process.CommandLine
    WScript.Echo "---"
  End If
Next
