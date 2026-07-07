# Backups and Restore

This document goes over the backup/restore process only from the lens of manipulating files—nothing relating to real OpenShift backup infrastructure.

## Backups

Backups are run nightly automatically in a FIFO strategy with a maximum of 10 files. The backup files are stored in the same PVC as the regular database files.

You can also run manual backups—these can be deleted from the admin interface and do not count toward the 10 total FIFO backups.

## Restore

The database can be restored using one of the backup files previously made. 

You will need to turn off the app pod to release PVC claims and create an ephermeral pod to run the restore operations.

In CLI, run:

```bash
oc run db-restore-pod --image=docker.io/library/node:22-alpine --overrides='
{
  "spec": {
    "containers": [
      {
        "name": "debugger",
        "image": "docker.io/library/node:22-alpine",
        "command": ["sleep", "3600m"],
        "volumeMounts": [
          {
            "name": "target-pvc-volume",
            "mountPath": "/data/db"
          }
        ]
      }
    ],
    "volumes": [
      {
        "name": "target-pvc-volume",
        "persistentVolumeClaim": {
          "claimName": "cydb-submissions-db"
        }
      }
    ]
  }
}'
```

You can either use OpenShift UI terminal or local oc CLI to unzip and copy files around as needed.

After the desired database file has been restored, delete the extra files used to restore and delete the `db-restore-pod` pod.

You can then scale up the regular app deployment to restart it and confirm the restoration worked as expected.