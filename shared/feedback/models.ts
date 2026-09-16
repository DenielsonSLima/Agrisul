export type NotificationKind='created'|'updated'|'saved'|'deleted'|'error';

export type NotificationOptions={
 description?:string;
 duration?:number;
};

export type ConfirmationOptions={
 title:string;
 description:string;
 confirmLabel?:string;
 cancelLabel?:string;
 tone?:'default'|'destructive';
};
